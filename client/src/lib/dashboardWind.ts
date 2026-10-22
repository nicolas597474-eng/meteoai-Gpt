import type { HourlyFallbackProvenance } from "@shared/hourlyFallbackProvenance";
import {
  withCurrentSnapshotFallback,
  type CurrentStateFieldLike,
} from "./dashboardPresentation";

/**
 * Vent du Dashboard : exactement les valeurs de la page Prévisions.
 *
 * Les deux pages lisent la même prévision horaire officielle (Open-Meteo) et la
 * même échéance active ; le Dashboard n’agrège plus les stations pour le vent,
 * ce qui affichait par exemple 9 km/h là où les Prévisions indiquaient 33 km/h.
 */
export type DashboardWindKey = "windSpeed" | "windGust" | "windDirection";

export type DashboardWindHour = {
  validAt?: number | null;
  windSpeed?: number | null;
  windGust?: number | null;
  windDirection?: number | null;
  fallbackProvenance?: HourlyFallbackProvenance;
};

export type DashboardWindSnapshot = Partial<Record<DashboardWindKey, number | null>>;

export type DashboardWind = {
  speedField: CurrentStateFieldLike | null;
  gustField: CurrentStateFieldLike | null;
  directionField: CurrentStateFieldLike | null;
  /** km/h, valeur non arrondie de la source retenue. */
  speed: number | null;
  /** km/h, valeur non arrondie de la source retenue. */
  gust: number | null;
  /** Degrés, 0 = nord. */
  direction: number | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fieldNumber(field: CurrentStateFieldLike | null): number | null {
  return finiteNumber(field?.value);
}

/**
 * Retient d’abord la ligne de prévision horaire officielle de l’heure active,
 * telle quelle (une valeur absente reste « — », comme sur la page Prévisions).
 * Sans échéance active, par exemple pendant le chargement de la prévision,
 * seul le snapshot courant Open-Meteo sert de repli. Les stations ne sont
 * jamais utilisées pour le vent.
 */
export function getDashboardWind(input: {
  hour: DashboardWindHour | null | undefined;
  /** Libellé affichable de la source de la prévision horaire, ex. « Open-Meteo ». */
  forecastSource: string;
  forecastComputedAt?: string | null;
  snapshot?: DashboardWindSnapshot | null;
  snapshotCapturedAt?: string | null;
  nowMs?: number;
}): DashboardWind {
  const { hour } = input;
  const validAt = finiteNumber(hour?.validAt);

  const fieldFor = (key: DashboardWindKey): CurrentStateFieldLike | null => {
    if (hour && validAt !== null) {
      // OpenWeather ne complète que la vitesse et la direction : jamais les rafales.
      const fallback = key === "windGust" ? undefined : hour.fallbackProvenance?.[key];
      return {
        value: finiteNumber(hour[key]),
        provenance: {
          kind: "official_hourly_forecast",
          label: "Prévision horaire officielle",
          stationCount: 0,
          stationSources: [fallback ? `${fallback.provider} (repli)` : input.forecastSource],
          observedAt: new Date(validAt).toISOString(),
          computedAt: input.forecastComputedAt ?? null,
          ageMinutes: null,
          reason: fallback
            ? `Valeur complétée par ${fallback.provider} : absente de la prévision ${input.forecastSource} pour cette échéance.`
            : "Valeur de l’échéance active, identique à celle de la page Prévisions.",
          measurements: [],
        },
      };
    }
    return withCurrentSnapshotFallback(
      null,
      input.snapshot?.[key],
      input.snapshotCapturedAt,
      input.nowMs,
    );
  };

  const speedField = fieldFor("windSpeed");
  const gustField = fieldFor("windGust");
  const directionField = fieldFor("windDirection");
  return {
    speedField,
    gustField,
    directionField,
    speed: fieldNumber(speedField),
    gust: fieldNumber(gustField),
    direction: fieldNumber(directionField),
  };
}
