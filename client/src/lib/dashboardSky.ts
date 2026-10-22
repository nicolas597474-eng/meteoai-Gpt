import type { HourlyFallbackProvenance } from "@shared/hourlyFallbackProvenance";
import { getOfficialHourlyCondition } from "./officialHourlyCard";
import { type CurrentStateFieldLike } from "./dashboardPresentation";

/**
 * État du ciel du Dashboard : exactement les valeurs de la page Prévisions.
 *
 * Le hero du Dashboard lisait le snapshot « current » d’Open-Meteo, calculé sur le
 * seul modèle best_match (par exemple 1 % de nébulosité, « Ensoleillé »), alors que
 * la page Prévisions et l’en-tête « État du ciel » du même Dashboard lisent la
 * prévision horaire officielle consolidée (« Partiellement nuageux »). Les deux
 * pages affichaient donc deux ciels différents pour la même heure.
 *
 * Comme pour le vent, le Dashboard retient la ligne de l’échéance active, traitée
 * par la même fonction que la page Prévisions (`getOfficialHourlyCondition`) ; le
 * snapshot courant ne sert que de repli tant qu’aucune échéance active n’est
 * disponible. Aucune valeur n’est mélangée entre les deux sources.
 */
export type DashboardSkyKey = "condition" | "cloudCover" | "weatherCode";

export type DashboardSkyHour = {
  validAt?: number | null;
  condition?: string | null;
  weatherCode?: number | null;
  cloudCover?: number | null;
  precipitation?: number | null;
  fallbackProvenance?: HourlyFallbackProvenance;
};

export type DashboardSky = {
  conditionField: CurrentStateFieldLike | null;
  cloudCoverField: CurrentStateFieldLike | null;
  weatherCodeField: CurrentStateFieldLike | null;
  /** Libellé de la source retenue, jamais dérivé d’un mélange de sources. */
  condition: string | null;
  /** % de nébulosité de la source retenue, valeur non arrondie. */
  cloudCover: number | null;
  /** Code WMO de la source retenue. */
  weatherCode: number | null;
  /** Vrai quand les trois valeurs viennent de la prévision horaire officielle. */
  fromOfficialHour: boolean;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string | null {
  const label = typeof value === "string" ? value.trim() : "";
  return label || null;
}

/** Seule la nébulosité peut être complétée par OpenWeather ; jamais le code WMO ni le libellé. */
function fallbackProviderFor(
  hour: DashboardSkyHour | null | undefined,
  key: DashboardSkyKey
) {
  return key === "cloudCover"
    ? hour?.fallbackProvenance?.cloudCover
    : undefined;
}

export function getDashboardSky(input: {
  hour: DashboardSkyHour | null | undefined;
  /** Libellé affichable de la source de la prévision horaire, ex. « Open-Meteo ». */
  forecastSource: string;
  forecastComputedAt?: string | null;
  /** Valeurs déjà qualifiées (stations puis snapshot) : uniques replis hors échéance active. */
  fallbackFields?: Partial<
    Record<DashboardSkyKey, CurrentStateFieldLike | null>
  >;
}): DashboardSky {
  const { hour } = input;
  const validAt = finiteNumber(hour?.validAt);
  const useOfficialHour = hour != null && validAt !== null;

  if (!useOfficialHour) {
    const conditionField = input.fallbackFields?.condition ?? null;
    const cloudCoverField = input.fallbackFields?.cloudCover ?? null;
    const weatherCodeField = input.fallbackFields?.weatherCode ?? null;
    return {
      conditionField,
      cloudCoverField,
      weatherCodeField,
      condition: textValue(conditionField?.value),
      cloudCover: finiteNumber(cloudCoverField?.value),
      weatherCode: finiteNumber(weatherCodeField?.value),
      fromOfficialHour: false,
    };
  }

  const buildField = (
    key: DashboardSkyKey,
    value: number | string | null
  ): CurrentStateFieldLike => {
    const fallback = fallbackProviderFor(hour, key);
    return {
      value,
      provenance: {
        kind: "official_hourly_forecast",
        label: "Prévision horaire officielle",
        stationCount: 0,
        stationSources: [
          fallback ? `${fallback.provider} (repli)` : input.forecastSource,
        ],
        observedAt: new Date(validAt as number).toISOString(),
        computedAt: input.forecastComputedAt ?? null,
        ageMinutes: null,
        reason: fallback
          ? `Valeur complétée par ${fallback.provider} : absente de la prévision ${input.forecastSource} pour cette échéance.`
          : "Valeur de l’échéance active, identique à celle de la page Prévisions.",
        measurements: [],
      },
    };
  };

  const conditionField = buildField(
    "condition",
    getOfficialHourlyCondition(hour)
  );
  const cloudCoverField = buildField(
    "cloudCover",
    finiteNumber(hour.cloudCover)
  );
  const weatherCodeField = buildField(
    "weatherCode",
    finiteNumber(hour.weatherCode)
  );

  return {
    conditionField,
    cloudCoverField,
    weatherCodeField,
    condition: textValue(conditionField.value),
    cloudCover: finiteNumber(cloudCoverField.value),
    weatherCode: finiteNumber(weatherCodeField.value),
    fromOfficialHour: true,
  };
}
