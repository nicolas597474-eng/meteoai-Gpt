import { describe, expect, it, vi } from "vitest";
import {
  angularDifferenceDegrees,
  isAromeWcsEnabled,
  runHondeghemAromeShadowComparison,
  verifyHondeghemAromeWindDirectionAvailability,
} from "./aromeHondeghemShadow";

const RUN = "2026-09-29T00:00:00Z";
const TIMES = ["2026-09-29T00:00", "2026-09-29T01:00", "2026-09-29T02:00"];

const forecastPayload = {
  hourly: {
    time: TIMES,
    temperature_2m: [11, 12, 13],
    precipitation: [1.5, 0.5, 0],
    wind_speed_10m: [20, 21, 22],
    wind_direction_10m: [350, 355, 10],
  },
};
const singleRunsPayload = {
  hourly: {
    time: TIMES,
    temperature_2m: [11.5, 12, 12.5],
    precipitation: [1, 0.5, 0.2],
    wind_speed_10m: [18, 21, 24],
    wind_direction_10m: [10, 355, 350],
  },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function createOpenMeteoFetchMock(options?: {
  metaStatus?: number;
  metaLastRun?: string | null;
  forecastStatus?: number;
  forecastPayload?: unknown;
  singleRunsStatus?: number;
  singleRunsReason?: string;
  singleRunsPayload?: unknown;
}) {
  const requests: URL[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString());
      requests.push(url);
      if (
        url.hostname === "api.open-meteo.com" &&
        url.pathname.endsWith("/static/meta.json")
      ) {
        if (options?.metaStatus && options.metaStatus !== 200)
          return response({}, options.metaStatus);
        return response({
          last_run_initialisation_time:
            options?.metaLastRun === null
              ? null
              : Date.parse(options?.metaLastRun ?? RUN) / 1000,
          update_interval_seconds: 10_800,
        });
      }
      if (
        url.hostname === "api.open-meteo.com" &&
        url.pathname === "/v1/forecast"
      ) {
        return response(
          options?.forecastPayload ?? forecastPayload,
          options?.forecastStatus ?? 200
        );
      }
      if (url.hostname === "single-runs-api.open-meteo.com") {
        if (options?.singleRunsStatus && options.singleRunsStatus !== 200) {
          return response(
            {
              error: true,
              reason: options.singleRunsReason ?? "run indisponible",
            },
            options.singleRunsStatus
          );
        }
        return response(options?.singleRunsPayload ?? singleRunsPayload);
      }
      // Tout appel Météo-France authentifié (OAuth2, WCS) échouerait en 401 :
      // le chemin par défaut ne doit jamais l'atteindre.
      if (url.hostname.endsWith("meteofrance.fr")) return response({}, 401);
      throw new Error(`Unexpected test URL: ${url.origin}${url.pathname}`);
    }
  );
  return { fetchImpl, requests };
}

const meteofranceCalls = (requests: URL[]) =>
  requests.filter(url => url.hostname.endsWith("meteofrance.fr"));

describe("AROME shadow — chemin Open-Meteo par défaut (sans WCS ni clé Météo-France)", () => {
  it("désactive le WCS par défaut", () => {
    expect(isAromeWcsEnabled()).toBe(false);
    expect(isAromeWcsEnabled(false)).toBe(false);
    expect(isAromeWcsEnabled(true)).toBe(true);
  });

  it("calcule un écart circulaire modulo 360°, pas une soustraction simple", () => {
    expect(angularDifferenceDegrees(350, 10)).toBe(20);
    expect(angularDifferenceDegrees(10, 350)).toBe(20);
    expect(angularDifferenceDegrees(359, 1)).toBe(2);
    expect(angularDifferenceDegrees(0, 180)).toBe(180);
    expect(angularDifferenceDegrees(45, 45)).toBe(0);
    expect(angularDifferenceDegrees(360, 0)).toBe(0);
    expect(angularDifferenceDegrees(null, 10)).toBeNull();
    expect(angularDifferenceDegrees(350, null)).toBeNull();
    expect(angularDifferenceDegrees(Number.NaN, 10)).toBeNull();
  });

  it("récupère AROME uniquement via Open-Meteo, sans lire de clé ni appeler Météo-France, direction comprise", async () => {
    const { fetchImpl, requests } = createOpenMeteoFetchMock();
    const result = await runHondeghemAromeShadowComparison({
      // Même fournie, l'ancienne clé ne doit pas être lue dans le chemin par défaut.
      oauthApplicationId: "synthetic-application-id-a-ignorer",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T01:00:00Z"),
    });

    expect(result.status, result.message).toBe("ok");
    expect(meteofranceCalls(requests)).toEqual([]);
    expect(result.runProven).toBe(true);
    expect(result.run).toBe(RUN);
    expect(result.openMeteoRun).toBe("2026-09-29T00:00");
    expect(result.hourly).toHaveLength(3);

    const forecastRequest = requests.find(
      url =>
        url.hostname === "api.open-meteo.com" && url.pathname === "/v1/forecast"
    )!;
    expect(forecastRequest.searchParams.get("models")).toBe(
      "meteofrance_arome_france_hd"
    );
    expect(forecastRequest.searchParams.get("hourly")).toBe(
      "temperature_2m,precipitation,wind_speed_10m,wind_direction_10m"
    );

    const singleRunsRequest = requests.find(
      url => url.hostname === "single-runs-api.open-meteo.com"
    )!;
    expect(singleRunsRequest.searchParams.get("models")).toBe(
      "meteofrance_arome_france_hd"
    );
    expect(singleRunsRequest.searchParams.get("run")).toBe("2026-09-29T00:00");
    expect(singleRunsRequest.searchParams.get("hourly")).toContain(
      "wind_direction_10m"
    );

    expect(result.hourly[0].metrics.temperature).toMatchObject({
      arome: 11,
      openMeteoArome: 11.5,
      difference: -0.5,
    });
    expect(result.hourly[0].metrics.precipitation).toMatchObject({
      arome: 1.5,
      openMeteoArome: 1,
      difference: 0.5,
    });
    expect(result.hourly[0].metrics.windSpeed).toMatchObject({
      arome: 20,
      openMeteoArome: 18,
      difference: 2,
    });
    // 350° (Forecast) contre 10° (Single Runs, même run) : écart circulaire de 20°, pas 340°.
    expect(result.hourly[0].metrics.windDirection).toMatchObject({
      arome: 350,
      openMeteoArome: 10,
      difference: 20,
      unit: "°",
    });
    expect(result.hourly[2].metrics.windDirection).toMatchObject({
      arome: 10,
      openMeteoArome: 350,
      difference: 20,
    });

    // Moyenne journalière de direction : circulaire (350°, 355°, 10° restent au nord), pas arithmétique.
    expect(result.daily[0].metrics.windDirection.arome).not.toBeCloseTo(
      (350 + 355 + 10) / 3
    );
    expect(result.daily[0].metrics.windDirection.difference).not.toBeNull();
  });

  it("garde null une valeur Open-Meteo nulle pour une heure, sans inventer d'écart", async () => {
    const { fetchImpl } = createOpenMeteoFetchMock({
      forecastPayload: {
        hourly: {
          time: TIMES,
          temperature_2m: [11, null, 13],
          precipitation: [1.5, 0.5, 0],
          wind_speed_10m: [20, 21, 22],
          wind_direction_10m: [350, null, 10],
        },
      },
    });
    const result = await runHondeghemAromeShadowComparison({
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T01:00:00Z"),
    });

    expect(result.status).toBe("partial");
    const nullHour = result.hourly[1];
    expect(nullHour.metrics.temperature.arome).toBeNull();
    expect(nullHour.metrics.temperature.openMeteoArome).toBe(12);
    expect(nullHour.metrics.temperature.difference).toBeNull();
    expect(nullHour.metrics.temperature.issue).toContain("absente ou nulle");
    expect(nullHour.metrics.windDirection.arome).toBeNull();
    expect(nullHour.metrics.windDirection.difference).toBeNull();
    expect(
      result.missing.some(
        item => item.includes("temperature") && item.includes("nulle")
      )
    ).toBe(true);
    // Les heures nulles sont exclues des agrégats journaliers, pas remplacées.
    expect(result.daily[0].metrics.temperature.arome).toBe(12);
    expect(result.daily[0].metrics.windDirection.hours).toBe(2);
    expect(result.daily[0].metrics.windDirection.arome).toBe(0);
  });

  it("affiche « run non prouvé » sans inventer de run quand les métadonnées Open-Meteo ne répondent pas", async () => {
    const { fetchImpl, requests } = createOpenMeteoFetchMock({
      metaStatus: 404,
    });
    const result = await runHondeghemAromeShadowComparison({
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T00:30:00Z"),
    });

    expect(result.status).toBe("partial");
    expect(result.runProven).toBe(false);
    expect(result.run).toBeNull();
    expect(result.openMeteoRun).toBeNull();
    expect(result.message).toContain("Run non prouvé");
    expect(result.missing.some(item => item.includes("Run non prouvé"))).toBe(
      true
    );
    // Aucun run supposé n'est demandé à Single Runs; les valeurs Forecast restent présentées.
    expect(
      requests.some(url => url.hostname === "single-runs-api.open-meteo.com")
    ).toBe(false);
    expect(meteofranceCalls(requests)).toEqual([]);
    expect(result.hourly).toHaveLength(3);
    expect(result.hourly[0].metrics.temperature.arome).toBe(11);
    expect(result.hourly[0].metrics.temperature.openMeteoArome).toBeNull();
    expect(result.hourly[0].metrics.temperature.difference).toBeNull();
  });

  it("ne substitue aucun autre run quand Single Runs refuse le run prouvé", async () => {
    const { fetchImpl, requests } = createOpenMeteoFetchMock({
      singleRunsStatus: 400,
      singleRunsReason:
        "Run 2026-09-29T00:00 is not available for model meteofrance_arome_france_hd",
    });
    const result = await runHondeghemAromeShadowComparison({
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T01:00:00Z"),
    });

    expect(result.status).toBe("partial");
    expect(result.runProven).toBe(true);
    expect(
      requests.filter(url => url.hostname === "single-runs-api.open-meteo.com")
    ).toHaveLength(1);
    expect(result.missing.some(item => item.includes("aucun autre run"))).toBe(
      true
    );
    expect(result.hourly[0].metrics.temperature.arome).toBe(11);
    expect(result.hourly[0].metrics.temperature.openMeteoArome).toBeNull();
  });

  it("échoue explicitement sans repli WCS quand Open-Meteo Forecast est indisponible", async () => {
    const { fetchImpl, requests } = createOpenMeteoFetchMock({
      forecastStatus: 503,
    });
    const result = await runHondeghemAromeShadowComparison({
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T01:00:00Z"),
    });

    expect(result.status).toBe("request-impossible");
    expect(result.message).toContain(
      "WCS Météo-France authentifié n’a pas été sollicité"
    );
    expect(result.hourly).toEqual([]);
    expect(meteofranceCalls(requests)).toEqual([]);
  });

  it("ne lance ni lecture de clé ni requête pour la vérification DD(10 m) quand le WCS est désactivé", async () => {
    const fetchImpl = vi.fn();
    const result = await verifyHondeghemAromeWindDirectionAvailability({
      oauthApplicationId: "synthetic-application-id-a-ignorer",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.status).toBe("wcs-disabled");
    expect(result.message).toContain("wind_direction_10m");
    expect(result.candidates).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
