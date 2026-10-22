export const WINDY_MAP_PREFERENCES_STORAGE_KEY = "meteoai.windy-map-preferences.v1";

export const DEFAULT_WINDY_MAP_PREFERENCES = {
  layer: "rain",
  compactZoom: 8,
  fullscreenZoom: 8,
} as const;

export type WindyMapPreferences = {
  layer: string;
  compactZoom: number;
  fullscreenZoom: number;
};

export type WindyMapPreferencesByLocation = Record<string, WindyMapPreferences>;

const VALID_LAYERS = new Set(["rain", "wind", "clouds", "temp", "pressure", "humidity"]);
const MIN_COMPACT_ZOOM = 5;
const MAX_COMPACT_ZOOM = 11;
const MIN_FULLSCREEN_ZOOM = 3;
const MAX_FULLSCREEN_ZOOM = 14;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePreferences(value: unknown): WindyMapPreferences {
  const input = isRecord(value) ? value : {};
  return {
    layer: typeof input.layer === "string" && VALID_LAYERS.has(input.layer) ? input.layer : DEFAULT_WINDY_MAP_PREFERENCES.layer,
    compactZoom: clamp(input.compactZoom, MIN_COMPACT_ZOOM, MAX_COMPACT_ZOOM, DEFAULT_WINDY_MAP_PREFERENCES.compactZoom),
    fullscreenZoom: clamp(input.fullscreenZoom, MIN_FULLSCREEN_ZOOM, MAX_FULLSCREEN_ZOOM, DEFAULT_WINDY_MAP_PREFERENCES.fullscreenZoom),
  };
}

export function makeLegacyWindyMapLocationKey(lat: number, lon: number) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/**
 * A saved favorite is the product-level identity for preferences. Coordinates
 * stay as a precise fallback for temporary locations; the old four-decimal key
 * is retained only to migrate an existing setting on first access.
 */
export function makeWindyMapLocationKey(lat: number, lon: number, favoriteId?: number) {
  if (typeof favoriteId === "number" && Number.isInteger(favoriteId) && favoriteId > 0) {
    return `favorite:${favoriteId}`;
  }
  return `coordinates:${lat.toFixed(6)},${lon.toFixed(6)}`;
}

export function readWindyMapPreferences(): WindyMapPreferencesByLocation {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(WINDY_MAP_PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).map(([locationKey, value]) => [locationKey, normalizePreferences(value)]),
    );
  } catch {
    return {};
  }
}

export function writeWindyMapPreferences(locationKey: string, preferences: WindyMapPreferences) {
  if (typeof window === "undefined") return;

  try {
    const current = readWindyMapPreferences();
    window.localStorage.setItem(
      WINDY_MAP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...current,
        [locationKey]: normalizePreferences(preferences),
      }),
    );
  } catch {
    // localStorage peut être indisponible en navigation privée ou sous une politique restrictive.
  }
}

export function getWindyMapPreferences(locationKey: string, legacyLocationKey?: string): WindyMapPreferences {
  const current = readWindyMapPreferences();
  const saved = current[locationKey];
  if (saved) return saved;

  const legacy = legacyLocationKey ? current[legacyLocationKey] : undefined;
  if (!legacy) return DEFAULT_WINDY_MAP_PREFERENCES;

  // Preserve existing layer and both zooms when upgrading from the legacy
  // coordinate-rounded key. Keep the legacy value too: another favorite at the
  // same historical coordinate must be able to migrate independently.
  writeWindyMapPreferences(locationKey, legacy);
  return legacy;
}
