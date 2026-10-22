export type ForecastUpsertInput = {
  serviceCategory: "public" | "expert";
  tempMax?: number | null;
  tempMin?: number | null;
  precipitation?: number | null;
  windSpeed?: number | null;
  windGust?: number | null;
  humidity?: number | null;
  cloudCover?: number | null;
  condition?: string | null;
  rawData?: unknown;
};

/** Champs renouvelés lorsqu’une collecte remplace la même date/modèle/lieu. */
export function buildForecastUpdateSet(row: ForecastUpsertInput, collectedAt: Date) {
  return {
    serviceCategory: row.serviceCategory,
    tempMax: row.tempMax,
    tempMin: row.tempMin,
    precipitation: row.precipitation,
    windSpeed: row.windSpeed,
    windGust: row.windGust,
    humidity: row.humidity,
    cloudCover: row.cloudCover,
    condition: row.condition,
    rawData: row.rawData,
    collectedAt,
  };
}
