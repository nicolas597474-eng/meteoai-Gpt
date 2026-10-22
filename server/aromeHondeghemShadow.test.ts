/**
 * Chemin hérité WCS/GeoTIFF : conservé mais désactivé par défaut.
 * Tous les appels de ce fichier optent explicitement pour `wcsEnabled: true`
 * (équivalent AROME_WCS_ENABLED=true) pour prouver que le repli reste réversible.
 * Le chemin Open-Meteo par défaut est couvert par aromeHondeghemOpenMeteo.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPointFromGeoTiffBytes, runHondeghemAromeShadowComparison, SINGLE_RUN_FORECAST_DAYS, verifyHondeghemAromeWindDirectionAvailability } from "./aromeHondeghemShadow";

const RUN = "2026-09-29T00:00:00Z";
/** Identifiants de couverture tels que le catalogue WCS les publie pour un run donné. */
const coverageIdsAt = (run: string) => {
  const stamp = run.replace(/T(\d{2}):(\d{2}):(\d{2})Z$/, "T$1.$2.$3Z");
  return [
    `TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___${stamp}`,
    `TOTAL_WATER_PRECIPITATION__GROUND_OR_WATER_SURFACE___${stamp}_PT1H`,
    `WIND_SPEED__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___${stamp}`,
  ];
};
const coverageIds = coverageIdsAt(RUN);
const capabilities = (ids = coverageIds, includeGeoTiff = true) => `<wcs:Capabilities><ows:OperationsMetadata><ows:Operation name="GetCoverage"><ows:Parameter name="format"><ows:AllowedValues>${includeGeoTiff ? "<ows:Value>image/tiff</ows:Value>" : ""}<ows:Value>application/wmo-grib</ows:Value></ows:AllowedValues></ows:Parameter></ows:Operation></ows:OperationsMetadata><wcs:Contents>${ids.map((id) => `<wcs:CoverageSummary><wcs:CoverageId>${id}</wcs:CoverageId></wcs:CoverageSummary>`).join("")}</wcs:Contents></wcs:Capabilities>`;
const coverageDescription = (metric: "temperature" | "precipitation" | "windSpeed" | "windDirection") => {
  const unit = metric === "temperature" ? "K" : metric === "windSpeed" ? "m s-1" : metric === "windDirection" ? "degree" : "kg m-2";
  const heights = metric === "temperature" ? "2" : metric === "windSpeed" || metric === "windDirection" ? "10" : "0";
  return `<wcs:CoverageDescriptions><wcs:CoverageDescription><gml:boundedBy><gml:EnvelopeWithTimePeriod axisLabels="long lat height time" uomLabels="deg deg m ISO8601"><gml:beginPosition>${RUN}</gml:beginPosition><gml:endPosition>2026-09-29T02:00:00Z</gml:endPosition></gml:EnvelopeWithTimePeriod></gml:boundedBy><gml:domainSet><gmlrgrid:ReferenceableGridByVectors><gmlrgrid:generalGridAxis><gmlrgrid:GeneralGridAxis><gmlrgrid:offsetVector srsDimension="4" axisLabels="long lat height time" uomLabels="deg deg m s"/><gmlrgrid:gridAxesSpanned>height</gmlrgrid:gridAxesSpanned><gmlrgrid:coefficients>${heights}</gmlrgrid:coefficients></gmlrgrid:GeneralGridAxis></gmlrgrid:generalGridAxis><gmlrgrid:generalGridAxis><gmlrgrid:GeneralGridAxis><gmlrgrid:offsetVector srsDimension="4" axisLabels="long lat height time" uomLabels="deg deg m s"/><gmlrgrid:gridAxesSpanned>time</gmlrgrid:gridAxesSpanned><gmlrgrid:coefficients>0 3600 7200</gmlrgrid:coefficients></gmlrgrid:GeneralGridAxis></gmlrgrid:generalGridAxis></gmlrgrid:ReferenceableGridByVectors></gml:domainSet><swe:rangeType><swe:DataRecord><swe:field><swe:Quantity><swe:uom code="${unit}"/></swe:Quantity></swe:field></swe:DataRecord></swe:rangeType></wcs:CoverageDescription></wcs:CoverageDescriptions>`;
};
const openMeteo = {
  hourly: {
    time: ["2026-09-29T00:00", "2026-09-29T01:00", "2026-09-29T02:00"],
    temperature_2m: [11, 12, 13],
    precipitation: [1.5, 0.5, 0],
    wind_speed_10m: [20, 21, 22],
  },
};

function response(body: string | ArrayBuffer, status = 200): Response {
  return new Response(body, { status });
}
function createFetchMock(options?: { missingPrecip?: boolean; authStatus?: number; tokenStatus?: number; coverageFailure?: number; openMeteoStatus?: number; openMeteoReason?: string; noGeoTiff?: boolean; coverageIdList?: string[]; metaLastRun?: string | null; metaStatus?: number; unavailableRuns?: string[] }) {
  let currentCoverage = "";
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input.toString());
    requests.push({ url, init });
    if (url.hostname === "portail-api.meteofrance.fr" && url.pathname === "/token") {
      return response(JSON.stringify({ access_token: "synthetic-access-token", expires_in: 3600 }), options?.tokenStatus ?? 200);
    }
    if (url.pathname.endsWith("/GetCapabilities")) {
      const ids = options?.coverageIdList ?? coverageIds;
      return options?.authStatus
        ? response("", options.authStatus)
        : response(capabilities(options?.missingPrecip ? ids.filter((id) => !id.startsWith("TOTAL_WATER")) : ids, !options?.noGeoTiff));
    }
    if (url.hostname === "api.open-meteo.com") {
      if (options?.metaStatus && options.metaStatus !== 200) return response("", options.metaStatus);
      return response(JSON.stringify({
        last_run_initialisation_time: options?.metaLastRun ? Date.parse(options.metaLastRun) / 1000 : null,
        update_interval_seconds: 10_800,
      }));
    }
    if (url.hostname === "single-runs-api.open-meteo.com") {
      const requestedRun = url.searchParams.get("run") ?? "";
      if (options?.unavailableRuns?.some((unavailable) => requestedRun === unavailable.slice(0, 16))) {
        return response(JSON.stringify({ error: true, reason: `Run ${requestedRun} is not available for model meteofrance_arome_france_hd` }), 400);
      }
      if (options?.openMeteoReason) return response(JSON.stringify({ error: true, reason: options.openMeteoReason }), options?.openMeteoStatus ?? 400);
      return response(JSON.stringify(openMeteo), options?.openMeteoStatus ?? 200);
    }
    if (url.pathname.endsWith("/DescribeCoverage")) {
      const id = url.searchParams.get("coverageID") ?? "";
      return response(coverageDescription(id.startsWith("TEMPERATURE") ? "temperature" : id.startsWith("WIND_SPEED") ? "windSpeed" : "precipitation"));
    }
    if (url.pathname.endsWith("/GetCoverage")) {
      currentCoverage = url.searchParams.get("coverageid") ?? "";
      if (options?.coverageFailure) return response("", options.coverageFailure);
      return response(new Uint8Array([1, 2, 3, 4]).buffer);
    }
    throw new Error(`Unexpected test URL: ${url.origin}${url.pathname}`);
  });
  const decodePoint = vi.fn(async (_buffer: ArrayBuffer, latitude: number, longitude: number) => {
    expect(latitude).toBeCloseTo(50.7567);
    expect(longitude).toBeCloseTo(2.5204);
    if (currentCoverage.startsWith("TEMPERATURE")) return 283.15;
    if (currentCoverage.startsWith("WIND_SPEED")) return 5;
    return 2;
  });
  return { fetchImpl, requests, decodePoint };
}

describe("AROME Hondeghem shadow comparison", () => {
  beforeEach(() => vi.clearAllMocks());

  it("n’envoie aucune requête si l’identifiant OAuth manque pour la vérification de métadonnées", async () => {
    const fetchImpl = vi.fn();
    const result = await verifyHondeghemAromeWindDirectionAvailability({ oauthApplicationId: "", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch });
    expect(result.status).toBe("missing-key");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("interroge Single Runs avec forecast_days et sans start_hour/end_hour, non exposés par cet endpoint", async () => {
    const { fetchImpl, requests, decodePoint } = createFetchMock();
    const result = await runHondeghemAromeShadowComparison({
      oauthApplicationId: "synthetic-application-id", wcsEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T01:00:00Z"),
      sleep: async () => undefined,
      decodePoint,
    });
    expect(result.status, result.message).toBe("ok");
    const singleRuns = requests.find(({ url }) => url.hostname === "single-runs-api.open-meteo.com")!;
    expect(singleRuns.url.searchParams.get("start_hour")).toBeNull();
    expect(singleRuns.url.searchParams.get("end_hour")).toBeNull();
    expect(singleRuns.url.searchParams.get("forecast_days")).toBe(String(SINGLE_RUN_FORECAST_DAYS));
  });

  it("remonte le motif d’erreur Open-Meteo quand Single Runs refuse le run", async () => {
    const { fetchImpl } = createFetchMock({ openMeteoReason: "Run 2026-09-29T00:00 is not available for model meteofrance_arome_france_hd" });
    const result = await runHondeghemAromeShadowComparison({
      oauthApplicationId: "synthetic-application-id", wcsEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T01:00:00Z"),
      sleep: async () => undefined,
    });
    expect(result.status).toBe("request-impossible");
    expect(result.message).toContain("HTTP 400");
    expect(result.message).toContain("is not available");
    expect(result.message).toContain("aucun autre run n’a été substitué");
  });

  it("aligne le run sur le dernier run publié par Open-Meteo au lieu du plus récent du catalogue WCS", async () => {
    const { fetchImpl, requests, decodePoint } = createFetchMock({
      coverageIdList: [...coverageIdsAt("2026-09-29T03:00:00Z"), ...coverageIds],
      metaLastRun: RUN,
    });
    const result = await runHondeghemAromeShadowComparison({
      oauthApplicationId: "synthetic-application-id", wcsEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T04:00:00Z"),
      sleep: async () => undefined,
      decodePoint,
    });

    expect(result.status, result.message).toBe("ok");
    expect(result.run).toBe(RUN);
    expect(result.hourly).toHaveLength(3);
    const singleRunsRequests = requests.filter(({ url }) => url.hostname === "single-runs-api.open-meteo.com");
    expect(singleRunsRequests).toHaveLength(1);
    expect(singleRunsRequests[0].url.searchParams.get("run")).toBe("2026-09-29T00:00");
    const metadataRequest = requests.find(({ url }) => url.hostname === "api.open-meteo.com")!;
    expect(metadataRequest.url.pathname).toBe("/data/meteofrance_arome_france_hd/static/meta.json");
    expect(result.message).toContain("Run comparé 2026-09-29T00:00 UTC");
    expect(result.message).toContain("2026-09-29T03:00");
    expect(result.message).toContain("le plus récent publié à la fois par le catalogue WCS et par Open-Meteo Single Runs");
  });

  it("sonde le run plus ancien quand les métadonnées Open-Meteo sont illisibles et que Single Runs refuse le plus récent", async () => {
    const { fetchImpl, requests, decodePoint } = createFetchMock({
      coverageIdList: [...coverageIdsAt("2026-09-29T03:00:00Z"), ...coverageIds],
      metaStatus: 404,
      unavailableRuns: ["2026-09-29T03:00"],
    });
    const result = await runHondeghemAromeShadowComparison({
      oauthApplicationId: "synthetic-application-id", wcsEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T04:00:00Z"),
      sleep: async () => undefined,
      decodePoint,
    });

    expect(result.status, result.message).toBe("ok");
    expect(result.run).toBe(RUN);
    expect(requests.filter(({ url }) => url.hostname === "single-runs-api.open-meteo.com").map(({ url }) => url.searchParams.get("run")))
      .toEqual(["2026-09-29T03:00", "2026-09-29T00:00"]);
    expect(result.message).toContain("Run comparé 2026-09-29T00:00 UTC");
    expect(result.message).toContain("2026-09-29T03:00");
  });

  it("conserve le run le plus récent du catalogue quand Open-Meteo publie au moins ce cycle", async () => {
    const { fetchImpl, requests, decodePoint } = createFetchMock({ metaLastRun: "2026-09-29T06:00:00Z" });
    const result = await runHondeghemAromeShadowComparison({
      oauthApplicationId: "synthetic-application-id", wcsEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T07:00:00Z"),
      sleep: async () => undefined,
      decodePoint,
    });

    expect(result.status, result.message).toBe("ok");
    const singleRunsRequests = requests.filter(({ url }) => url.hostname === "single-runs-api.open-meteo.com");
    expect(singleRunsRequests).toHaveLength(1);
    expect(singleRunsRequests[0].url.searchParams.get("run")).toBe("2026-09-29T00:00");
    expect(result.message).not.toContain("Run comparé");
  });

  it("n’essaie pas un autre run quand Single Runs échoue pour une raison autre qu’un run indisponible", async () => {
    const { fetchImpl, requests } = createFetchMock({
      coverageIdList: [...coverageIdsAt("2026-09-29T03:00:00Z"), ...coverageIds],
      metaStatus: 404,
      openMeteoStatus: 404,
    });
    const result = await runHondeghemAromeShadowComparison({
      oauthApplicationId: "synthetic-application-id", wcsEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async () => undefined,
    });

    expect(result.status).toBe("request-impossible");
    expect(result.message).toContain("aucun autre run n’a été substitué");
    expect(result.message).not.toContain("Runs essayés sans succès");
    expect(requests.filter(({ url }) => url.hostname === "single-runs-api.open-meteo.com")).toHaveLength(1);
  });

  it("refuse un jeton d’accès collé dans METEOFRANCE_API_KEY sans interroger le portail", async () => {
    const fetchImpl = vi.fn();
    const jwt = `${Buffer.from('{"alg":"HS256"}', "utf8").toString("base64url")}.${Buffer.from('{"sub":"x"}', "utf8").toString("base64url")}.sig`;
    const verification = await verifyHondeghemAromeWindDirectionAvailability({ oauthApplicationId: jwt, wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch });
    expect(verification.status).toBe("invalid-key");
    expect(fetchImpl).not.toHaveBeenCalled();

    const comparison = await runHondeghemAromeShadowComparison({ oauthApplicationId: jwt, wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch });
    expect(comparison.status).toBe("invalid-key");
    expect(comparison.message).toContain("jeton d’accès");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("encode une paire client_id:client_secret avant l’en-tête Basic", async () => {
    const { fetchImpl, requests, decodePoint } = createFetchMock();
    const result = await runHondeghemAromeShadowComparison({
      oauthApplicationId: "my-client-id:my-client-secret", wcsEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T01:00:00Z"),
      sleep: async () => undefined,
      decodePoint,
    });
    expect(result.status, result.message).toBe("ok");
    const tokenRequest = requests.find(({ url }) => url.pathname === "/token")!;
    expect((tokenRequest.init?.headers as Record<string, string>).Authorization)
      .toBe(`Basic ${Buffer.from("my-client-id:my-client-secret", "utf8").toString("base64")}`);
  });

  it("découvre l’ID réel au clic et confirme seulement les métadonnées 10 m, degrés et temps du run", async () => {
    const syntheticDirectionId = "SYNTHETIC_WIND_DIRECTION_FIELD___2026-09-29T00.00.00Z";
    const requests: URL[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString());
      requests.push(url);
      if (url.pathname === "/token") return response(JSON.stringify({ access_token: "synthetic-access-token" }));
      if (url.pathname.endsWith("/GetCapabilities")) return response(capabilities([...coverageIds, syntheticDirectionId]));
      if (url.pathname.endsWith("/DescribeCoverage")) return response(coverageDescription("windDirection"));
      throw new Error(`Unexpected verification URL: ${url.origin}${url.pathname}`);
    });
    const result = await verifyHondeghemAromeWindDirectionAvailability({
      oauthApplicationId: "synthetic-application-id", wcsEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T01:00:00Z"),
    });

    expect(result.status).toBe("verified");
    expect(result.run).toBe(RUN);
    expect(result.candidates).toEqual([expect.objectContaining({
      coverageId: syntheticDirectionId,
      run: RUN,
      unit: "degree",
      heights: [10],
      heightAxisUnit: "m",
      validTimeCount: 3,
      metadataConfirmed: true,
      issues: [],
    })]);
    expect(requests.some((url) => url.hostname === "single-runs-api.open-meteo.com")).toBe(false);
    expect(requests.some((url) => url.pathname.endsWith("/GetCoverage"))).toBe(false);
  });

  it("ne confirme pas un champ candidat dont l’unité n’est pas angulaire ou dont la hauteur n’est pas 10 m", async () => {
    const syntheticDirectionId = "SYNTHETIC_WIND_DIRECTION_FIELD___2026-09-29T00.00.00Z";
    const invalidDescription = coverageDescription("windDirection").replace('code="degree"', 'code="m/s"').replace("<gmlrgrid:coefficients>10</gmlrgrid:coefficients>", "<gmlrgrid:coefficients>2</gmlrgrid:coefficients>");
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString());
      if (url.pathname === "/token") return response(JSON.stringify({ access_token: "synthetic-access-token" }));
      if (url.pathname.endsWith("/GetCapabilities")) return response(capabilities([...coverageIds, syntheticDirectionId]));
      if (url.pathname.endsWith("/DescribeCoverage")) return response(invalidDescription);
      throw new Error(`Unexpected verification URL: ${url.origin}${url.pathname}`);
    });
    const result = await verifyHondeghemAromeWindDirectionAvailability({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch });
    expect(result.status).toBe("not-confirmed");
    expect(result.candidates[0]).toMatchObject({ metadataConfirmed: false, unit: "m/s", heights: [2] });
    expect(result.candidates[0].issues.join(" ")).toMatch(/degrés|10 m/);
  });

  it("signale un catalogue sans identifiant direction reconnaissable sans affirmer que le champ n’existe pas", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString());
      if (url.pathname === "/token") return response(JSON.stringify({ access_token: "synthetic-access-token" }));
      if (url.pathname.endsWith("/GetCapabilities")) return response(capabilities());
      throw new Error(`Unexpected verification URL: ${url.origin}${url.pathname}`);
    });
    const result = await verifyHondeghemAromeWindDirectionAvailability({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch });
    expect(result.status).toBe("not-advertised");
    expect(result.message).toContain("ne prouve pas l’absence");
    expect(result.candidates).toEqual([]);
  });

  it("does not send any request when the OAuth2 application identifier is missing", async () => {
    const fetchImpl = vi.fn();
    const result = await runHondeghemAromeShadowComparison({ oauthApplicationId: "", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch });
    expect(result.status).toBe("missing-key");
    expect(result.message).toContain("METEOFRANCE_API_KEY");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the advertised GeoTIFF format, samples Hondeghem and compares the exact common run with units converted", async () => {
    const { fetchImpl, requests, decodePoint } = createFetchMock();
    const result = await runHondeghemAromeShadowComparison({
      oauthApplicationId: "synthetic-application-id", wcsEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-09-29T01:00:00Z"),
      sleep: async () => undefined,
      decodePoint,
    });

    expect(result.status, result.message).toBe("ok");
    expect(result.run).toBe(RUN);
    expect(result.openMeteoRun).toBe("2026-09-29T00:00");
    expect(result.hourly).toHaveLength(3);
    expect(result.hourly[0]).toMatchObject({
      validAt: "2026-09-29T00:00:00.000Z",
      metrics: {
        temperature: { arome: 10, openMeteoArome: 11, difference: -1, unit: "°C" },
        precipitation: { arome: 2, openMeteoArome: 1.5, difference: 0.5, unit: "mm / heure" },
        windSpeed: { arome: 18, openMeteoArome: 20, difference: -2, unit: "km/h" },
      },
    });
    expect(result.daily).toHaveLength(1);
    const singleRunsRequest = requests.find(({ url }) => url.hostname === "single-runs-api.open-meteo.com")!;
    expect(singleRunsRequest.url.searchParams.get("run")).toBe("2026-09-29T00:00");
    expect(singleRunsRequest.url.searchParams.get("models")).toBe("meteofrance_arome_france_hd");
    expect(singleRunsRequest.url.searchParams.get("temperature_unit")).toBe("celsius");
    expect(singleRunsRequest.url.searchParams.get("wind_speed_unit")).toBe("kmh");
    expect(singleRunsRequest.url.searchParams.get("precipitation_unit")).toBe("mm");
    const tempCoverage = requests.find(({ url }) => url.pathname.endsWith("/GetCoverage") && url.searchParams.get("coverageid")?.startsWith("TEMPERATURE"))!;
    const windCoverage = requests.find(({ url }) => url.pathname.endsWith("/GetCoverage") && url.searchParams.get("coverageid")?.startsWith("WIND_SPEED"))!;
    const precipCoverage = requests.find(({ url }) => url.pathname.endsWith("/GetCoverage") && url.searchParams.get("coverageid")?.startsWith("TOTAL_WATER"))!;
    expect(tempCoverage.url.searchParams.get("format")).toBe("image/tiff");
    expect(tempCoverage.url.searchParams.getAll("subset")).toContain("height(2)");
    expect(windCoverage.url.searchParams.getAll("subset")).toContain("height(10)");
    expect(precipCoverage.url.searchParams.getAll("subset")).toContain("height(0)");
    const tokenRequest = requests.find(({ url }) => url.pathname === "/token")!;
    expect(tokenRequest.init?.method).toBe("POST");
    expect((tokenRequest.init?.headers as Record<string, string>).Authorization).toBe("Basic synthetic-application-id");
    expect(tokenRequest.init?.body).toBe("grant_type=client_credentials");
    expect(tokenRequest.url.search).toBe("");
    for (const wcsRequest of requests.filter(({ url }) => url.hostname === "public-api.meteofrance.fr")) {
      const headers = wcsRequest.init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer synthetic-access-token");
      expect(headers.apikey).toBeUndefined();
      expect(wcsRequest.url.toString()).not.toContain("synthetic-application-id");
      expect(wcsRequest.url.toString()).not.toContain("synthetic-access-token");
    }
    for (const getCoverage of [tempCoverage, windCoverage]) {
      expect(getCoverage.url.searchParams.getAll("subset")).toContain("lat(50.7167,50.7967)");
      expect(getCoverage.url.searchParams.getAll("subset")).toContain("long(2.4804,2.5604)");
    }
    expect(decodePoint).toHaveBeenCalledTimes(9);
  });

  it("returns an explicit authentication error instead of falling back to another run", async () => {
    const { fetchImpl } = createFetchMock({ authStatus: 401 });
    const result = await runHondeghemAromeShadowComparison({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch, sleep: async () => undefined });
    expect(result.status).toBe("authentication-error");
    expect(result.run).toBeNull();
    expect(result.message).toContain("401");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops before requesting AROME when the OAuth2 application credential is rejected", async () => {
    const { fetchImpl, requests } = createFetchMock({ tokenStatus: 401 });
    const result = await runHondeghemAromeShadowComparison({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch });
    expect(result.status).toBe("authentication-error");
    expect(result.message).toContain("HTTP 401");
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/token");
  });

  it("does not substitute another model/run when Single Runs has no copy of the WCS run", async () => {
    const { fetchImpl, requests } = createFetchMock({ openMeteoStatus: 404 });
    const result = await runHondeghemAromeShadowComparison({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch, sleep: async () => undefined });
    expect(result.status).toBe("request-impossible");
    expect(result.hourly).toHaveLength(0);
    expect(result.message).toContain("aucun autre run n’a été substitué");
    expect(requests.some(({ url }) => url.pathname.endsWith("/GetCoverage"))).toBe(false);
  });

  it("does not invent a GeoTIFF media type when WCS does not advertise one", async () => {
    const { fetchImpl, requests } = createFetchMock({ noGeoTiff: true });
    const result = await runHondeghemAromeShadowComparison({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch, sleep: async () => undefined });
    expect(result.status).toBe("request-impossible");
    expect(result.message).toContain("n’annonce aucun format GeoTIFF");
    expect(requests.some(({ url }) => url.hostname === "single-runs-api.open-meteo.com")).toBe(false);
  });

  it("reports unavailable hourly precipitation metadata rather than comparing an unknown accumulation period", async () => {
    const { fetchImpl, decodePoint } = createFetchMock({ missingPrecip: true });
    const result = await runHondeghemAromeShadowComparison({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch, sleep: async () => undefined, decodePoint });
    expect(result.status).toBe("partial");
    expect(result.missing.some((item) => item.includes("PT1H"))).toBe(true);
    expect(result.hourly[0].metrics.precipitation.arome).toBeNull();
    expect(result.hourly[0].metrics.precipitation.openMeteoArome).toBe(1.5);
  });

  it("marks WCS 403 unavailable coverage per valid time rather than treating it as a key error", async () => {
    const { fetchImpl, decodePoint } = createFetchMock({ coverageFailure: 403 });
    const result = await runHondeghemAromeShadowComparison({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch, sleep: async () => undefined, decodePoint });
    expect(result.status).toBe("partial");
    expect(result.hourly).toHaveLength(3);
    expect(result.hourly[0].metrics.temperature.arome).toBeNull();
    expect(result.hourly[0].metrics.temperature.openMeteoArome).toBe(11);
    expect(result.missing.some((item) => item.includes("HTTP 403"))).toBe(true);
  });

  it("uses GeoTIFF georeferencing to sample the point pixel, rejects a different CRS and preserves nodata", async () => {
    const readRasters = vi.fn(async (options: { window: number[] }) => {
      expect(options.window).toEqual([2, 4, 3, 5]);
      return [new Float32Array([142])];
    });
    const image = {
      getGeoKeys: () => ({ GeographicTypeGeoKey: 4326 }),
      getOrigin: () => [2.5, 50.8, 0],
      getResolution: () => [0.01, -0.01, 0],
      getWidth: () => 10,
      getHeight: () => 10,
      pixelIsArea: () => true,
      readRasters,
      getGDALNoData: () => -9999,
    };
    const openTiff = vi.fn(async () => ({ getImage: async () => image }) as any);
    expect(await getPointFromGeoTiffBytes(new ArrayBuffer(8), 50.7567, 2.5204, undefined, openTiff as any)).toBe(142);
    expect(readRasters).toHaveBeenCalledTimes(1);

    const projectedTiff = vi.fn(async () => ({ getImage: async () => ({ ...image, getGeoKeys: () => ({ GeographicTypeGeoKey: 3857 }) }) }) as any);
    await expect(getPointFromGeoTiffBytes(new ArrayBuffer(8), 50.7567, 2.5204, undefined, projectedTiff as any)).rejects.toThrow("crs-not-wgs84");

    const nodataTiff = vi.fn(async () => ({ getImage: async () => ({ ...image, readRasters: async () => [new Float32Array([-9999])] }) }) as any);
    expect(await getPointFromGeoTiffBytes(new ArrayBuffer(8), 50.7567, 2.5204, undefined, nodataTiff as any)).toBeNull();
  });

  it("identifie l’étape et la cause technique quand une requête fournisseur lève une exception", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      throw new Error("connection reset by peer");
    });
    const result = await runHondeghemAromeShadowComparison({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.status).toBe("request-impossible");
    expect(result.message).toContain("pendant l’échange OAuth2 Météo-France");
    expect(result.message).toContain("connection reset by peer");
    expect(result.message).toContain("aucune prévision de production n’a été modifiée");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("signale explicitement un délai de 20 s dépassé plutôt qu’une cause générique", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    const result = await runHondeghemAromeShadowComparison({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.status).toBe("request-impossible");
    expect(result.message).toContain("délai de 20 s dépassé");
    errorSpy.mockRestore();
  });

  it("identifie aussi l’étape et la cause pour la vérification de la direction du vent", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString());
      if (url.pathname === "/token") return response(JSON.stringify({ access_token: "synthetic-access-token" }));
      throw new Error("catalogue WCS illisible");
    });
    const result = await verifyHondeghemAromeWindDirectionAvailability({ oauthApplicationId: "synthetic-application-id", wcsEnabled: true, fetchImpl: fetchImpl as typeof fetch });
    expect(result.status).toBe("request-impossible");
    expect(result.message).toContain("pendant la lecture du catalogue WCS AROME");
    expect(result.message).toContain("catalogue WCS illisible");
    errorSpy.mockRestore();
  });
});
