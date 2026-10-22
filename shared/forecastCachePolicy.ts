/** Fréquence de réception des prévisions ; les conditions actuelles restent séparées. */
export const HOURLY_FORECAST_CACHE_MS=30*60_000;
export const DAILY_FORECAST_CACHE_MS=60*60_000;
export const MAX_SAVED_FORECAST_MS=48*60*60_000;
export function forecastBatchTtl(key:string){return key.includes('/daily-full-v4/')?DAILY_FORECAST_CACHE_MS:HOURLY_FORECAST_CACHE_MS;}
