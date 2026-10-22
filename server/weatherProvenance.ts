import type { DatedDailyFusionFallback, OfficialWeatherSnapshot } from "./officialWeatherSnapshot";

export type WeatherProvenance = {
  kind: "hourly_forecast" | "daily_fusion" | "unavailable";
  label: string;
  detail: string;
  updatedAt: string | null;
  source: string | null;
  fallbackReason: "hourly_unavailable" | "no_hourly_or_daily_fusion" | null;
  hourlyCoverage: number;
  dailyCoverage: number;
  modelsUsed: number;
};

export function buildWeatherProvenance(
  snapshot: Pick<OfficialWeatherSnapshot, "computedAt" | "source" | "hourly" | "daily" | "modelsUsed">,
  dailyFallback: DatedDailyFusionFallback | null,
): WeatherProvenance {
  const base = {
    hourlyCoverage: snapshot.hourly.length,
    dailyCoverage: snapshot.daily.length,
    modelsUsed: snapshot.modelsUsed.length,
  };

  if (snapshot.hourly.length > 0) {
    return {
      ...base,
      kind: "hourly_forecast",
      label: "Prévision horaire officielle",
      detail: `${snapshot.hourly.length} créneaux horaires disponibles ; source ${snapshot.source}.`,
      updatedAt: snapshot.computedAt,
      source: snapshot.source,
      fallbackReason: null,
    };
  }

  if (dailyFallback) {
    return {
      ...base,
      kind: "daily_fusion",
      label: "Fusion quotidienne archivée",
      detail: `Créneaux horaires indisponibles ; fusion du ${dailyFallback.date} utilisée en repli.`,
      updatedAt: dailyFallback.computedAt,
      source: "meteoai_daily_fusion",
      fallbackReason: "hourly_unavailable",
    };
  }

  return {
    ...base,
    kind: "unavailable",
    label: "Données météo temporairement indisponibles",
    detail: "Aucun créneau horaire ni fusion quotidienne réelle n’est disponible.",
    updatedAt: null,
    source: null,
    fallbackReason: "no_hourly_or_daily_fusion",
  };
}
