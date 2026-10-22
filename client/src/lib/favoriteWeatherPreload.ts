export type FavoriteWeatherCoordinates = {
  lat: number;
  lon: number;
};

export const FAVORITE_WEATHER_PRELOAD_CONCURRENCY = 2;

/**
 * A user can save the same coordinates more than once under different names.
 * Weather query keys are coordinate-based, so preload each exact point once.
 */
export function getUniqueFavoriteWeatherCoordinates(
  favorites: readonly FavoriteWeatherCoordinates[]
): FavoriteWeatherCoordinates[] {
  const seen = new Set<string>();
  const locations: FavoriteWeatherCoordinates[] = [];

  for (const favorite of favorites) {
    const { lat, lon } = favorite;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      continue;
    }

    const key = `${lat},${lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({ lat, lon });
  }

  return locations;
}

/**
 * Warm favorite locations in a small queue so a large account does not send a
 * burst of weather requests at session startup. One failed location must not
 * block the rest, and the caller can stop scheduling new work on unmount/logout.
 */
export async function preloadFavoriteWeatherLocations(
  locations: readonly FavoriteWeatherCoordinates[],
  preload: (location: FavoriteWeatherCoordinates) => Promise<unknown>,
  options: {
    concurrency?: number;
    shouldCancel?: () => boolean;
  } = {}
): Promise<void> {
  if (locations.length === 0) return;

  const requestedConcurrency =
    options.concurrency ?? FAVORITE_WEATHER_PRELOAD_CONCURRENCY;
  const concurrency = Math.max(
    1,
    Number.isFinite(requestedConcurrency)
      ? Math.floor(requestedConcurrency)
      : FAVORITE_WEATHER_PRELOAD_CONCURRENCY
  );
  const workerCount = Math.min(locations.length, concurrency);
  let nextIndex = 0;

  const worker = async () => {
    while (!options.shouldCancel?.()) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= locations.length) return;

      try {
        await preload(locations[index]);
      } catch {
        // Keep warming the other favorites when one upstream request fails.
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
