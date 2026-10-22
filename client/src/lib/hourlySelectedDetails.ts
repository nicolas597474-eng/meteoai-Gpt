import { formatOptionalForecastValue } from "./forecastTimeline";
import {
  getApparentTempTone,
  getCloudCoverTone,
  getHumidityTone,
  getPrecipitationTone,
  getPressureTone,
  getUvTone,
  getVisibilityTone,
  WIND_VALUE_COLOR,
} from "./observationTone";
import { isSnowWmoWeatherCode } from "./forecastDayDisplay";
import type {
  HourlyFallbackProvenance,
  OpenWeatherFallbackField,
} from "@shared/hourlyFallbackProvenance";

export type HourlySelectedForecast = {
  validAt?: number | null;
  temp?: number | null;
  apparentTemp?: number | null;
  precipitation?: number | null;
  precipitationComponents?: Array<{ modelName: string; rain: number | null; showers: number | null; snowfall: number | null }> | null;
  windSpeed?: number | null;
  windGust?: number | null;
  windDirection?: number | null;
  humidity?: number | null;
  dewPoint?: number | null;
  cloudCover?: number | null;
  cloudLow?: number | null;
  cloudMid?: number | null;
  cloudHigh?: number | null;
  pressure?: number | null;
  uvIndex?: number | null;
  visibility?: number | null;
  solarRadiation?: number | null;
  weatherCode?: number | null;
  precipType?: string | null;
  precipIntensity?: string | null;
  fallbackProvenance?: HourlyFallbackProvenance;
  multiModelMetrics?: {
    source?: string | null;
    bestMatchIncluded?: boolean | null;
    precipitation?: {
      thresholdMm?: number | null;
      rainModelCount?: number | null;
      availableModelCount?: number | null;
    } | null;
  } | null;
};

export type HourlySelectedDetail = {
  key: string;
  title: string;
  icon: string;
  value: string;
  summary: string;
  validAt: number | null;
  note?: string;
  /** Classe Tailwind (code couleur) adaptée à l'intensité de la valeur. */
  valueTone?: string;
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatWithUnit(
  value: number | null | undefined,
  decimals: number,
  unit: string
): string {
  return finite(value)
    ? formatOptionalForecastValue(value, decimals, unit)
    : `—${unit}`;
}

function formatNumber(value: number | null | undefined, decimals = 0): string {
  return finite(value) ? formatOptionalForecastValue(value, decimals) : "—";
}

/** Formats raw component values by contributor; it never averages or fills missing values. */
export function formatHourlyPrecipitationComponentValues(
  components: ReadonlyArray<{ modelName: string; rain: number | null; showers: number | null; snowfall: number | null }> | null | undefined,
  field: "rain" | "showers" | "snowfall",
  unit: string,
): string {
  if (!components?.length) return `—${unit}`;
  return components
    .map(({ modelName, ...values }) => `${modelName} ${formatWithUnit(values[field], 1, unit)}`)
    .join(" · ");
}

function windDirectionLabel(degrees: number): string {
  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSO",
    "SO",
    "OSO",
    "O",
    "ONO",
    "NO",
    "NNO",
  ];
  return directions[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

function fallbackSourceNote(
  provenance: HourlyFallbackProvenance | undefined,
  fields: readonly OpenWeatherFallbackField[]
): string | undefined {
  const sources = fields.flatMap(field =>
    provenance?.[field] ? [provenance[field]!] : []
  );
  const uniqueSources = Array.from(
    new Map(
      sources.map(source => [
        `${source.provider}|${source.retrievedAt}|${source.validAt}`,
        source,
      ])
    ).values()
  );
  if (uniqueSources.length === 0) return undefined;
  return uniqueSources
    .map(source => {
      const retrieved = Number.isFinite(Date.parse(source.retrievedAt))
        ? new Intl.DateTimeFormat("fr-FR", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "Europe/Paris",
          }).format(new Date(source.retrievedAt))
        : "heure de réception indisponible";
      return `${source.provider} · ${source.product} · réponse obtenue par l’application ${retrieved} (Europe/Paris) · validTime UTC ${new Date(source.validAt).toISOString()} · run fournisseur non communiqué, fraîcheur amont inconnue.`;
    })
    .join(" ");
}

/** Build every field shown in the selected-hour panel from one exact official point. */
export function buildHourlySelectedDetails(
  hour: HourlySelectedForecast
): HourlySelectedDetail[] {
  const validAt =
    typeof hour.validAt === "number" &&
    Number.isSafeInteger(hour.validAt) &&
    Number.isFinite(new Date(hour.validAt).getTime())
      ? hour.validAt
      : null;
  const make = (
    key: string,
    title: string,
    icon: string,
    value: string,
    note?: string,
    valueTone?: string
  ): HourlySelectedDetail => ({
    key,
    title,
    icon,
    value,
    summary: value,
    validAt,
    ...(note ? { note } : {}),
    ...(valueTone ? { valueTone } : {}),
  });
  const precipitationMetrics =
    hour.multiModelMetrics?.source === "official_seven_models" &&
    hour.multiModelMetrics.bestMatchIncluded === false
      ? hour.multiModelMetrics.precipitation
      : null;
  const hasPrecipitationCounts =
    finite(precipitationMetrics?.rainModelCount) &&
    finite(precipitationMetrics?.availableModelCount);
  const precipitationNote = hasPrecipitationCounts
    ? `${precipitationMetrics.rainModelCount}/${precipitationMetrics.availableModelCount} modèles au seuil${finite(precipitationMetrics.thresholdMm) ? ` ≥ ${formatOptionalForecastValue(precipitationMetrics.thresholdMm, 1, " mm")}` : ""} · fréquence descriptive brute, pas une probabilité calibrée.`
    : undefined;
  const direction = finite(hour.windDirection)
    ? `${windDirectionLabel(hour.windDirection)} (${formatWithUnit(hour.windDirection, 1, "°")})`
    : "—";
  // Code couleur : teinte adaptée à l'intensité de chaque valeur, identique au panneau
  // « Observations actuelles » du dashboard (précipitations 0,0 mm = bleu, UV faible = vert…).
  const maxComponentValue = (field: "showers" | "snowfall"): number | null => {
    const values = (hour.precipitationComponents ?? [])
      .map((component) => component[field])
      .filter(finite);
    return values.length ? Math.max(...values) : null;
  };
  const maxShowers = maxComponentValue("showers");
  const maxSnowfall = maxComponentValue("snowfall");
  const details: HourlySelectedDetail[] = [];
  if (finite(hour.precipitation)) {
    details.push(make(
      "precipitation",
      "Précipitations",
      "precipitation",
      `Quantité ${formatWithUnit(hour.precipitation, 1, " mm")}`,
      precipitationNote,
      getPrecipitationTone(hour.precipitation).value
    ));
  }
  const precipitationComponents = hour.precipitationComponents ?? [];
  if (precipitationComponents.some(({ showers }) => finite(showers))) {
    details.push(make(
      "showers",
      "Averses",
      "precipitation",
      formatHourlyPrecipitationComponentValues(precipitationComponents, "showers", " mm"),
      "Valeurs brutes des modèles contributeurs au total de précipitations; aucune moyenne ni substitution.",
      maxShowers != null ? getPrecipitationTone(maxShowers).value : undefined
    ));
  }
  const hasPositiveSnowfall = precipitationComponents.some(
    ({ snowfall }) => finite(snowfall) && snowfall > 0
  );
  if (hasPositiveSnowfall || isSnowWmoWeatherCode(hour.weatherCode)) {
    const snowValue = hasPositiveSnowfall
      ? formatHourlyPrecipitationComponentValues(precipitationComponents, "snowfall", " cm")
      : "Neige prévue";
    const snowNote = hasPositiveSnowfall
      ? "Valeurs brutes des modèles contributeurs au total de précipitations; aucune moyenne ni substitution."
      : "Code météo WMO valide indiquant de la neige; aucune quantité positive de neige n’est fournie pour cette échéance.";
    details.push(make(
      "snowfall",
      "Neige",
      "snow",
      snowValue,
      snowNote,
      maxSnowfall != null ? getPrecipitationTone(maxSnowfall).value : undefined
    ));
  }
  details.push(
    make(
      "wind",
      "Vent",
      "wind_param",
      `Vent ${formatWithUnit(hour.windSpeed, 0, " km/h")} · direction ${direction} · rafales ${formatWithUnit(hour.windGust, 0, " km/h")}`,
      fallbackSourceNote(hour.fallbackProvenance, [
        "windSpeed",
        "windDirection",
      ]),
      WIND_VALUE_COLOR
    ),
    make(
      "humidity",
      "Humidité et rosée",
      "humidity",
      `Humidité ${formatWithUnit(hour.humidity, 0, " %")} · point de rosée ${formatWithUnit(hour.dewPoint, 1, " °C")}`,
      fallbackSourceNote(hour.fallbackProvenance, ["humidity"]),
      finite(hour.humidity) ? getHumidityTone(hour.humidity).value : undefined
    ),
    make(
      "clouds",
      "Nuages",
      "cloud_cover",
      `Total ${formatWithUnit(hour.cloudCover, 0, " %")} · basses ${formatWithUnit(hour.cloudLow, 0, " %")} · moyennes ${formatWithUnit(hour.cloudMid, 0, " %")} · hautes ${formatWithUnit(hour.cloudHigh, 0, " %")}`,
      fallbackSourceNote(hour.fallbackProvenance, ["cloudCover"]),
      finite(hour.cloudCover) ? getCloudCoverTone(hour.cloudCover).value : undefined
    ),
    make(
      "pressure",
      "Pression",
      "pressure",
      formatWithUnit(hour.pressure, 0, " hPa"),
      undefined,
      finite(hour.pressure) ? getPressureTone(hour.pressure).value : undefined
    ),
    make(
      "uv",
      "Indice UV",
      "sunny",
      formatNumber(hour.uvIndex, 1),
      undefined,
      finite(hour.uvIndex) ? getUvTone(hour.uvIndex).value : undefined
    ),
    make(
      "apparent",
      "Température ressentie",
      "thermometer",
      formatWithUnit(hour.apparentTemp, 1, " °C"),
      undefined,
      finite(hour.apparentTemp) ? getApparentTempTone(hour.apparentTemp).value : undefined
    ),
    make(
      "visibility",
      "Visibilité",
      "eye",
      formatWithUnit(hour.visibility, 1, " km"),
      undefined,
      finite(hour.visibility) ? getVisibilityTone(hour.visibility).value : undefined
    )
  );
  return details;
}
