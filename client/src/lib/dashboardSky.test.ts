import { describe, expect, it } from "vitest";
import { getDashboardSky } from "./dashboardSky";
import { getOfficialHourlyCondition } from "./officialHourlyCard";
import { formatCurrentStateProvenance } from "./dashboardPresentation";

// 15:00 Europe/Paris le 10 octobre 2026 (UTC+2) — échéance des captures de production.
const VALID_AT = Date.parse("2026-10-10T13:00:00.000Z");
const COMPUTED_AT = "2026-10-10T13:06:00.000Z";
const NOW_MS = Date.parse("2026-10-10T13:55:00.000Z");

// Conséquence multi-modèles de la page Prévisions pour cette échéance.
const officialHour = {
  validAt: VALID_AT,
  condition: "Partiellement nuageux",
  cloudCover: 58,
  weatherCode: 2,
  precipitation: 0,
};

// Snapshot « current » Open-Meteo (modèle best_match seul) affiché avant correction.
const snapshotFields = {
  condition: field("Ensoleillé", "open_meteo_snapshot"),
  cloudCover: field(1, "open_meteo_snapshot"),
  weatherCode: field(0, "open_meteo_snapshot"),
};

function field(
  value: number | string | null,
  kind: "open_meteo_snapshot" | "unavailable"
) {
  return {
    value,
    provenance: {
      kind,
      label:
        kind === "open_meteo_snapshot"
          ? "Snapshot modèle Open-Meteo"
          : "Indisponible",
      stationCount: 0,
      stationSources: kind === "open_meteo_snapshot" ? ["Open-Meteo"] : [],
      observedAt:
        kind === "open_meteo_snapshot" ? "2026-10-10T13:00:00.000Z" : null,
      ageMinutes: kind === "open_meteo_snapshot" ? 55 : null,
      reason:
        kind === "open_meteo_snapshot"
          ? "Repli Open-Meteo."
          : "Champ indisponible.",
      measurements: [],
    },
  };
}

function sky(overrides: Partial<Parameters<typeof getDashboardSky>[0]> = {}) {
  return getDashboardSky({
    hour: officialHour,
    forecastSource: "Open-Meteo",
    forecastComputedAt: COMPUTED_AT,
    fallbackFields: snapshotFields,
    ...overrides,
  });
}

describe("état du ciel du Dashboard aligné sur la page Prévisions", () => {
  it("reprend le ciel de l’heure officielle active, pas celui du snapshot best_match", () => {
    const result = sky();

    expect(result.condition).toBe("Partiellement nuageux");
    expect(result.cloudCover).toBe(58);
    expect(result.weatherCode).toBe(2);
    expect(result.fromOfficialHour).toBe(true);
    // Le snapshot seul aurait affiché un soleil avec 1 % de nuages.
    expect(snapshotFields.condition?.value).toBe("Ensoleillé");
  });

  it("donne au Dashboard exactement le texte que la carte de la page Prévisions", () => {
    const result = sky();
    const forecastPageCard = getOfficialHourlyCondition(officialHour);

    // Le hero et la pastille du lieu actif affichent cette chaîne, que l’icône suit.
    expect(result.condition).toBe(forecastPageCard);
    expect(result.condition).toBe("Partiellement nuageux");
    expect(snapshotFields.condition?.value).toBe("Ensoleillé");
  });

  it("nomme la nature, la source, l’échéance et l’heure de calcul de chaque valeur", () => {
    const result = sky();

    for (const key of [
      "conditionField",
      "cloudCoverField",
      "weatherCodeField",
    ] as const) {
      const field = result[key];
      expect(field?.provenance.kind).toBe("official_hourly_forecast");
      expect(field?.provenance.label).toBe("Prévision horaire officielle");
      expect(formatCurrentStateProvenance(field, null, NOW_MS)).toBe(
        "Prévu · Open-Meteo · 15:00 · calcul 15:06"
      );
    }
  });

  it("ne mélange pas les sources : une échéance sans libellé reste indisponible", () => {
    const result = sky({
      hour: {
        ...officialHour,
        condition: null,
        cloudCover: null,
        precipitation: null,
        weatherCode: null,
      },
    });

    expect(result.condition).toBeNull();
    expect(result.cloudCover).toBeNull();
    expect(result.weatherCode).toBeNull();
    expect(result.fromOfficialHour).toBe(true);
    // Les valeurs du snapshot ne reviennent pas masquer un champ non fourni.
    expect(result.conditionField?.value).toBeNull();
    expect(result.conditionField?.provenance.kind).toBe(
      "official_hourly_forecast"
    );
  });

  it("dérive le libellé du nébulosité consolidée quand la prévision ne le fournit pas", () => {
    const result = sky({
      hour: {
        validAt: VALID_AT,
        condition: null,
        cloudCover: 58,
        weatherCode: null,
        precipitation: 0,
      },
    });

    expect(result.condition).toBe("Partiellement nuageux");
    expect(result.condition).toBe(
      getOfficialHourlyCondition({ cloudCover: 58, precipitation: 0 })
    );
  });

  it("n’utilise que les valeurs déjà qualifiées tant qu’aucune échéance active n’est disponible", () => {
    for (const hour of [null, undefined, { ...officialHour, validAt: null }]) {
      const result = sky({ hour });

      expect(result.fromOfficialHour).toBe(false);
      expect(result.condition).toBe("Ensoleillé");
      expect(result.cloudCover).toBe(1);
      expect(result.weatherCode).toBe(0);
      expect(result.conditionField?.provenance.kind).toBe(
        "open_meteo_snapshot"
      );
      expect(
        formatCurrentStateProvenance(result.conditionField, null, NOW_MS)
      ).toBe("Open-Meteo · 15:00 · il y a 55 min");
    }
  });

  it("laisse l’état indisponible sans échéance active ni valeur qualifiée", () => {
    const result = sky({ hour: null, fallbackFields: {} });

    expect(result.condition).toBeNull();
    expect(result.cloudCover).toBeNull();
    expect(result.weatherCode).toBeNull();
    expect(result.conditionField).toBeNull();
    expect(result.cloudCoverField).toBeNull();
  });

  it("n’attribue pas à Open-Meteo une nébulosité complétée par OpenWeather", () => {
    const result = sky({
      hour: {
        ...officialHour,
        fallbackProvenance: {
          cloudCover: {
            provider: "OpenWeatherMap",
            endpoint: "https://api.openweathermap.org/data/2.5/forecast",
            product: "Forecast 5 jours / 3 heures",
            validAt: VALID_AT,
            retrievedAt: COMPUTED_AT,
            providerRunAt: null,
            upstreamFreshness: "unknown",
          },
        },
      },
    });

    expect(
      formatCurrentStateProvenance(result.cloudCoverField, null, NOW_MS)
    ).toBe("Prévu · OpenWeatherMap (repli) · 15:00 · calcul 15:06");
    expect(result.cloudCoverField?.provenance.reason).toContain(
      "absente de la prévision Open-Meteo"
    );
    // Le libellé et le code WMO ne sont jamais complétés par OpenWeather.
    expect(
      formatCurrentStateProvenance(result.conditionField, null, NOW_MS)
    ).toBe("Prévu · Open-Meteo · 15:00 · calcul 15:06");
    expect(
      formatCurrentStateProvenance(result.weatherCodeField, null, NOW_MS)
    ).toBe("Prévu · Open-Meteo · 15:00 · calcul 15:06");
  });

  it("borne la nébulosité et le code WMO à des nombres finis", () => {
    const result = sky({
      hour: {
        ...officialHour,
        cloudCover: Number.NaN,
        weatherCode: Number.POSITIVE_INFINITY,
      },
    });

    expect(result.cloudCover).toBeNull();
    expect(result.weatherCode).toBeNull();
    expect(result.condition).toBe("Partiellement nuageux");
  });
});
