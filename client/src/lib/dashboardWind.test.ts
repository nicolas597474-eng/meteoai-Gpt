import { describe, expect, it } from "vitest";
import { formatCurrentStateProvenance } from "./dashboardPresentation";
import { getDashboardWind } from "./dashboardWind";
import { formatOptionalForecastValue } from "./forecastTimeline";
import { buildHourlySelectedDetails } from "./hourlySelectedDetails";

// 18:00 Europe/Paris le 9 octobre 2026 (UTC+2).
const VALID_AT = Date.parse("2026-10-09T16:00:00.000Z");
const COMPUTED_AT = "2026-10-09T16:06:00.000Z";
const NOW_MS = Date.parse("2026-10-09T16:38:00.000Z");

const officialHour = {
  validAt: VALID_AT,
  windSpeed: 32.6,
  windGust: 57.2,
  windDirection: 242.3,
};

// Valeurs réellement observées le 9 octobre 2026 sur le Dashboard avant correction (stations Netatmo).
const staleSnapshot = { windSpeed: 9.3, windGust: 22, windDirection: 233.5 };

function wind(overrides: Partial<Parameters<typeof getDashboardWind>[0]> = {}) {
  return getDashboardWind({
    hour: officialHour,
    forecastSource: "Open-Meteo",
    forecastComputedAt: COMPUTED_AT,
    snapshot: staleSnapshot,
    snapshotCapturedAt: "2026-10-09T16:00:00.000Z",
    nowMs: NOW_MS,
    ...overrides,
  });
}

describe("vent du Dashboard aligné sur la page Prévisions", () => {
  it("reprend les valeurs de l’heure officielle active, pas celles du snapshot ni des stations", () => {
    const result = wind();

    expect(result.speed).toBe(32.6);
    expect(result.gust).toBe(57.2);
    expect(result.direction).toBe(242.3);
  });

  it("affiche exactement le texte de vent de la page Prévisions pour la même échéance", () => {
    const result = wind();
    const forecastPageWind = buildHourlySelectedDetails(officialHour).find(({ key }) => key === "wind");

    expect(forecastPageWind?.value).toBe("Vent 33 km/h · direction OSO (242.3°) · rafales 57 km/h");
    expect(formatOptionalForecastValue(result.speed, 0, " km/h")).toBe("33 km/h");
    expect(formatOptionalForecastValue(result.gust, 0, " km/h")).toBe("57 km/h");
    expect(`${result.direction?.toFixed(1)}°`).toBe("242.3°");
    expect(forecastPageWind?.value).toContain(formatOptionalForecastValue(result.speed, 0, " km/h"));
    expect(forecastPageWind?.value).toContain(formatOptionalForecastValue(result.gust, 0, " km/h"));
  });

  it("nomme la nature, la source, l’échéance et l’heure de calcul de chaque valeur", () => {
    const result = wind();

    for (const field of [result.speedField, result.gustField, result.directionField]) {
      expect(field?.provenance.kind).toBe("official_hourly_forecast");
      expect(formatCurrentStateProvenance(field, null, NOW_MS)).toBe("Prévu · Open-Meteo · 18:00 · calcul 18:06");
    }
  });

  it("laisse « — » une valeur absente de l’heure officielle au lieu de la remplacer par le snapshot", () => {
    const result = wind({ hour: { ...officialHour, windGust: null } });

    expect(result.gust).toBeNull();
    expect(formatOptionalForecastValue(result.gust, 0, " km/h")).toBe("—");
    expect(result.speed).toBe(32.6);
    expect(result.gustField?.provenance.kind).toBe("official_hourly_forecast");
  });

  it("n’utilise que le snapshot courant Open-Meteo tant qu’aucune échéance active n’est disponible", () => {
    for (const hour of [null, undefined, { ...officialHour, validAt: null }]) {
      const result = wind({ hour });

      expect(result.speed).toBe(9.3);
      expect(result.gust).toBe(22);
      expect(result.direction).toBe(233.5);
      expect(result.speedField?.provenance.kind).toBe("open_meteo_snapshot");
      expect(formatCurrentStateProvenance(result.speedField, null, NOW_MS)).toBe("Open-Meteo · 18:00 · il y a 38 min");
    }
  });

  it("ne fabrique aucune valeur sans échéance active ni snapshot", () => {
    const result = wind({ hour: null, snapshot: null });

    expect(result.speed).toBeNull();
    expect(result.gust).toBeNull();
    expect(result.direction).toBeNull();
    expect(result.speedField).toBeNull();
  });

  it("n’attribue pas à Open-Meteo une vitesse ou une direction complétées par OpenWeather", () => {
    const openWeatherSource = {
      provider: "OpenWeatherMap" as const,
      endpoint: "https://api.openweathermap.org/data/2.5/forecast" as const,
      product: "Forecast 5 jours / 3 heures" as const,
      validAt: VALID_AT,
      retrievedAt: COMPUTED_AT,
      providerRunAt: null,
      upstreamFreshness: "unknown" as const,
    };
    const result = wind({
      hour: { ...officialHour, fallbackProvenance: { windSpeed: openWeatherSource, windDirection: openWeatherSource } },
    });

    expect(formatCurrentStateProvenance(result.speedField, null, NOW_MS)).toBe("Prévu · OpenWeatherMap (repli) · 18:00 · calcul 18:06");
    expect(formatCurrentStateProvenance(result.directionField, null, NOW_MS)).toBe("Prévu · OpenWeatherMap (repli) · 18:00 · calcul 18:06");
    expect(result.speedField?.provenance.reason).toContain("absente de la prévision Open-Meteo");
    // OpenWeather ne complète jamais les rafales.
    expect(formatCurrentStateProvenance(result.gustField, null, NOW_MS)).toBe("Prévu · Open-Meteo · 18:00 · calcul 18:06");
  });

  it("n’invente pas d’heure de calcul quand elle est inconnue", () => {
    const result = wind({ forecastComputedAt: null });

    expect(formatCurrentStateProvenance(result.speedField, null, NOW_MS)).toBe("Prévu · Open-Meteo · 18:00");
  });
});
