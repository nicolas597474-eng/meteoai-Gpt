import { fetchWeather } from "./weatherFetch";
import {
  buildOpenWeatherForecastUrl,
  OPENWEATHER_FORECAST_ENDPOINT,
} from "./openWeatherApi";

export const OPENWEATHER_SHADOW_FIELDS = [
  { key: "temperature", label: "Température", unit: "°C" },
  { key: "windSpeed", label: "Vitesse du vent", unit: "km/h" },
  { key: "windDirection", label: "Direction du vent", unit: "°" },
  { key: "humidity", label: "Humidité relative", unit: "%" },
  { key: "cloudCover", label: "Nébulosité totale", unit: "%" },
] as const;

export type OpenWeatherShadowField =
  (typeof OPENWEATHER_SHADOW_FIELDS)[number]["key"];
export type OpenWeatherShadowStatus =
  | "ok"
  | "partial"
  | "missing-key"
  | "request-impossible"
  | "no-common-times";

export type OpenWeatherShadowOfficialHour = {
  validAt: number;
  temp: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  humidity: number | null;
  cloudCover: number | null;
};

type OpenWeatherPoint = {
  validAt: number;
  values: Record<OpenWeatherShadowField, number | null>;
};

export type OpenWeatherShadowComparisonRow = {
  validAt: string;
  field: OpenWeatherShadowField;
  label: string;
  unit: string;
  openWeatherValue: number;
  officialValue: number;
  difference: number;
};

export type OpenWeatherShadowCoverage = {
  field: OpenWeatherShadowField;
  label: string;
  unit: string;
  openWeatherValueCount: number;
  officialValueCount: number;
  exactPairCount: number;
  openWeatherOnlyTimes: string[];
  officialOnlyTimes: string[];
};

export type OpenWeatherShadowResult = {
  status: OpenWeatherShadowStatus;
  message: string;
  comparedAt: string;
  provenance: {
    provider: "OpenWeatherMap";
    endpoint: typeof OPENWEATHER_FORECAST_ENDPOINT;
    product: "Forecast 5 jours / 3 heures";
    role: "comparateur shadow uniquement; ni modèle indépendant ni vote";
    modelRunIdentifierAvailable: false;
    validTimePolicy: "Correspondance exacte UTC uniquement; aucune interpolation ni regridding temporel.";
  };
  officialReference: "Série horaire officielle déjà affichée sur la page";
  openWeatherPointCount: number;
  officialHourCount: number;
  exactCommonTimeCount: number;
  comparisonRows: OpenWeatherShadowComparisonRow[];
  coverage: OpenWeatherShadowCoverage[];
  unsupportedFields: Array<{ field: string; reason: string }>;
  warnings: string[];
};

type RecordValue = Record<string, unknown>;
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

function asRecord(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeDirection(value: number): number {
  return ((value % 360) + 360) % 360;
}

function difference(
  field: OpenWeatherShadowField,
  openWeatherValue: number,
  officialValue: number
): number {
  if (field === "windDirection") {
    const delta =
      normalizeDirection(openWeatherValue) - normalizeDirection(officialValue);
    return round2(((delta + 540) % 360) - 180);
  }
  return round2(openWeatherValue - officialValue);
}

function officialValue(
  hour: OpenWeatherShadowOfficialHour,
  field: OpenWeatherShadowField
): number | null {
  switch (field) {
    case "temperature":
      return finiteNumber(hour.temp);
    case "windSpeed":
      return finiteNumber(hour.windSpeed);
    case "windDirection":
      return finiteNumber(hour.windDirection);
    case "humidity":
      return finiteNumber(hour.humidity);
    case "cloudCover":
      return finiteNumber(hour.cloudCover);
  }
}

function parseOpenWeatherPoints(list: unknown[]): {
  points: OpenWeatherPoint[];
  invalidCount: number;
  duplicateCount: number;
} {
  const byValidAt = new Map<number, OpenWeatherPoint>();
  let invalidCount = 0;
  let duplicateCount = 0;
  for (const raw of list) {
    const item = asRecord(raw);
    const seconds = finiteNumber(item.dt);
    if (
      seconds === null ||
      !Number.isSafeInteger(seconds) ||
      Math.abs(seconds) > Number.MAX_SAFE_INTEGER / 1000
    ) {
      invalidCount += 1;
      continue;
    }
    const validAt = seconds * 1000;
    if (!Number.isSafeInteger(validAt)) {
      invalidCount += 1;
      continue;
    }
    if (byValidAt.has(validAt)) {
      duplicateCount += 1;
      continue;
    }
    const main = asRecord(item.main);
    const wind = asRecord(item.wind);
    const clouds = asRecord(item.clouds);
    const windSpeedMs = finiteNumber(wind.speed);
    const direction = finiteNumber(wind.deg);
    byValidAt.set(validAt, {
      validAt,
      values: {
        temperature: finiteNumber(main.temp),
        windSpeed: windSpeedMs === null ? null : round2(windSpeedMs * 3.6),
        windDirection:
          direction === null ? null : round2(normalizeDirection(direction)),
        humidity: finiteNumber(main.humidity),
        cloudCover: finiteNumber(clouds.all),
      },
    });
  }
  return {
    points: Array.from(byValidAt.values()).sort(
      (a, b) => a.validAt - b.validAt
    ),
    invalidCount,
    duplicateCount,
  };
}

function isoTimes(values: number[]): string[] {
  return Array.from(new Set(values))
    .sort((a, b) => a - b)
    .map(value => new Date(value).toISOString());
}

const UNSUPPORTED_FIELDS = [
  {
    field: "precipitation",
    reason:
      "OpenWeather fournit rain.3h/snow.3h, des cumuls sur trois heures; ils ne sont pas répartis artificiellement sur les heures MeteoAI.",
  },
  {
    field: "wind gusts",
    reason:
      "La rafale OpenWeather peut être absente et sa fenêtre d’agrégation n’est pas établie comme équivalente au champ officiel; elle n’est pas comparée.",
  },
  {
    field: "pressure",
    reason:
      "La sémantique et le niveau de référence de OpenWeather main.pressure ne sont pas vérifiés comme équivalents à la pression de la série officielle.",
  },
  {
    field: "weather condition/code",
    reason:
      "Les codes et libellés météorologiques OpenWeather ne sont pas convertis vers le référentiel officiel dans cette étape.",
  },
  {
    field: "UV, point de rosée, visibilité, rayonnement",
    reason:
      "Ces champs ne sont pas exposés par l’endpoint Forecast 5 jours / 3 heures utilisé ici.",
  },
];

function resultBase(input: {
  status: OpenWeatherShadowStatus;
  message: string;
  comparedAt: string;
  officialHourCount: number;
  openWeatherPointCount?: number;
  exactCommonTimeCount?: number;
  comparisonRows?: OpenWeatherShadowComparisonRow[];
  coverage?: OpenWeatherShadowCoverage[];
  warnings?: string[];
}): OpenWeatherShadowResult {
  return {
    status: input.status,
    message: input.message,
    comparedAt: input.comparedAt,
    provenance: {
      provider: "OpenWeatherMap",
      endpoint: OPENWEATHER_FORECAST_ENDPOINT,
      product: "Forecast 5 jours / 3 heures",
      role: "comparateur shadow uniquement; ni modèle indépendant ni vote",
      modelRunIdentifierAvailable: false,
      validTimePolicy:
        "Correspondance exacte UTC uniquement; aucune interpolation ni regridding temporel.",
    },
    officialReference: "Série horaire officielle déjà affichée sur la page",
    openWeatherPointCount: input.openWeatherPointCount ?? 0,
    officialHourCount: input.officialHourCount,
    exactCommonTimeCount: input.exactCommonTimeCount ?? 0,
    comparisonRows: input.comparisonRows ?? [],
    coverage:
      input.coverage ??
      OPENWEATHER_SHADOW_FIELDS.map(field => ({
        field: field.key,
        label: field.label,
        unit: field.unit,
        openWeatherValueCount: 0,
        officialValueCount: 0,
        exactPairCount: 0,
        openWeatherOnlyTimes: [],
        officialOnlyTimes: [],
      })),
    unsupportedFields: [...UNSUPPORTED_FIELDS],
    warnings: input.warnings ?? [],
  };
}

/**
 * Makes one manual, read-only OpenWeather request and compares it with the exact
 * official hourly series already displayed by the caller. It never collects or
 * persists forecasts and never feeds the official engine.
 */
export async function compareOpenWeatherForecastWithOfficial(input: {
  apiKey: string;
  lat: number;
  lon: number;
  officialHours: readonly OpenWeatherShadowOfficialHour[];
  fetchImpl?: FetchLike;
  now?: () => Date;
}): Promise<OpenWeatherShadowResult> {
  const comparedAt = (input.now?.() ?? new Date()).toISOString();
  const officialHours = input.officialHours.filter(
    hour => Number.isSafeInteger(hour.validAt) && hour.validAt > 0
  );
  if (!input.apiKey.trim()) {
    return resultBase({
      status: "missing-key",
      message:
        "La clé OpenWeather existante n’est pas configurée; aucune requête n’a été envoyée.",
      comparedAt,
      officialHourCount: officialHours.length,
    });
  }

  try {
    const url = buildOpenWeatherForecastUrl({
      apiKey: input.apiKey,
      lat: input.lat,
      lon: input.lon,
    });
    const response = input.fetchImpl
      ? await input.fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json" },
        })
      : await fetchWeather(
          url,
          {},
          { timeoutMs: 8_000, attempts: 2, cacheTtlMs: 0 }
        );
    if (!response.ok) {
      return resultBase({
        status: "request-impossible",
        message: `OpenWeather a refusé la requête (HTTP ${response.status}); aucune donnée n’a été ajoutée au moteur officiel.`,
        comparedAt,
        officialHourCount: officialHours.length,
      });
    }
    const payload = asRecord(await response.json());
    const list = Array.isArray(payload.list) ? payload.list : [];
    const parsed = parseOpenWeatherPoints(list);
    const points = parsed.points;
    if (!points.length) {
      return resultBase({
        status: "request-impossible",
        message:
          "La réponse OpenWeather ne contient aucune échéance exploitable.",
        comparedAt,
        officialHourCount: officialHours.length,
        warnings: parsed.invalidCount
          ? [
              `${parsed.invalidCount} échéance(s) OpenWeather ignorée(s), horodatage invalide.`,
            ]
          : [],
      });
    }

    const officialByTime = new Map<number, OpenWeatherShadowOfficialHour>();
    for (const hour of officialHours)
      if (!officialByTime.has(hour.validAt))
        officialByTime.set(hour.validAt, hour);
    const openWeatherByTime = new Map(
      points.map(point => [point.validAt, point])
    );
    const exactCommonTimeCount = points.reduce(
      (count, point) => count + (officialByTime.has(point.validAt) ? 1 : 0),
      0
    );
    const comparisonRows: OpenWeatherShadowComparisonRow[] = [];
    const coverage: OpenWeatherShadowCoverage[] = [];

    for (const field of OPENWEATHER_SHADOW_FIELDS) {
      const openWeatherValues = points.filter(
        point => point.values[field.key] !== null
      );
      const officialValues = Array.from(officialByTime.entries())
        .map(([validAt, hour]) => ({
          validAt,
          value: officialValue(hour, field.key),
        }))
        .filter(
          (item): item is { validAt: number; value: number } =>
            item.value !== null
        );
      const openWeatherOnly: number[] = [];
      const officialOnly: number[] = [];
      let exactPairCount = 0;

      for (const point of openWeatherValues) {
        const hour = officialByTime.get(point.validAt);
        const localValue = hour ? officialValue(hour, field.key) : null;
        const externalValue = point.values[field.key];
        if (localValue === null || externalValue === null) {
          openWeatherOnly.push(point.validAt);
          continue;
        }
        exactPairCount += 1;
        comparisonRows.push({
          validAt: new Date(point.validAt).toISOString(),
          field: field.key,
          label: field.label,
          unit: field.unit,
          openWeatherValue: round2(externalValue),
          officialValue: round2(localValue),
          difference: difference(field.key, externalValue, localValue),
        });
      }

      for (const item of officialValues) {
        const externalValue =
          openWeatherByTime.get(item.validAt)?.values[field.key] ?? null;
        if (externalValue === null) officialOnly.push(item.validAt);
      }
      coverage.push({
        field: field.key,
        label: field.label,
        unit: field.unit,
        openWeatherValueCount: openWeatherValues.length,
        officialValueCount: officialValues.length,
        exactPairCount,
        openWeatherOnlyTimes: isoTimes(openWeatherOnly),
        officialOnlyTimes: isoTimes(officialOnly),
      });
    }

    const warnings: string[] = [];
    if (parsed.invalidCount)
      warnings.push(
        `${parsed.invalidCount} échéance(s) OpenWeather ignorée(s), horodatage invalide.`
      );
    if (parsed.duplicateCount)
      warnings.push(
        `${parsed.duplicateCount} échéance(s) OpenWeather dupliquée(s) ignorée(s).`
      );
    const hasUnmatched = coverage.some(
      item =>
        item.openWeatherOnlyTimes.length > 0 ||
        item.officialOnlyTimes.length > 0
    );
    const status: OpenWeatherShadowStatus =
      comparisonRows.length === 0
        ? "no-common-times"
        : hasUnmatched || warnings.length > 0
          ? "partial"
          : "ok";
    const message =
      status === "no-common-times"
        ? "Aucune paire de valeurs à validTime strictement identique n’est disponible; aucune interpolation n’a été tentée."
        : status === "partial"
          ? "Comparaison shadow partielle : seules les paires de champs et d’horaires UTC strictement identiques sont chiffrées; les manquants sont listés."
          : "Comparaison shadow terminée sur des validTime UTC exacts; la série OpenWeather reste hors du moteur et du vote officiels.";
    return resultBase({
      status,
      message,
      comparedAt,
      officialHourCount: officialHours.length,
      openWeatherPointCount: points.length,
      exactCommonTimeCount,
      comparisonRows,
      coverage,
      warnings,
    });
  } catch {
    return resultBase({
      status: "request-impossible",
      message:
        "Requête OpenWeather impossible; aucun secret ni corps de réponse n’est exposé et le moteur officiel reste inchangé.",
      comparedAt,
      officialHourCount: officialHours.length,
    });
  }
}
