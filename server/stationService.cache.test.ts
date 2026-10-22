import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cache de collecte des stations proches", () => {
  it("réutilise brièvement une collecte par lieu, rayon et session Netatmo", () => {
    const source = readFileSync(new URL("./stationService.ts", import.meta.url), "utf8");
    expect(source).toContain("NEARBY_STATIONS_CACHE_TTL_MS = 90_000");
    expect(source).toContain("makeNearbyStationsCacheKey(lat, lon, radiusKm, options.netatmoUserId)");
    expect(source).toContain('netatmoUserId ?? "public"');
    expect(source).toContain("if (cached?.pending) return { ...(await cached.pending), cacheHit: false }");
    expect(source).toContain("collectNearbyStationsUncached(lat, lon, radiusKm, townName, options)");
    expect(source).toContain("if (cached?.result && cached.expiresAt > now)");
    expect(source).toContain("stations: revalidateStationFreshness(cached.result.stations, now)");
    expect(source).toContain("sourceDiagnostics: StationSourceDiagnostic[]");
  });
});
