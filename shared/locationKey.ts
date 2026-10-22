/**
 * Shared utility: generate a stable location key from lat/lon.
 * Used to isolate data per location in the database.
 * Format: "lat_lon" rounded to 3 decimal places (≈ 111m precision).
 * e.g. makeLocationKey(50.7814, 2.5441) → "50.781_2.544"
 */
export function makeLocationKey(lat: number, lon: number): string {
  const latR = Math.round(lat * 1000) / 1000;
  const lonR = Math.round(lon * 1000) / 1000;
  return `${latR}_${lonR}`;
}

/** Default location key for legacy data (Hondeghem) */
export const DEFAULT_LOCATION_KEY = "default";
