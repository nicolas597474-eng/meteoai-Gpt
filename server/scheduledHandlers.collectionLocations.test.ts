import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FavoriteLocation } from "../drizzle/schema";

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    getAllFavoriteLocations: vi.fn(),
  };
});

import { withDefaultCollectionLocation } from "./scheduledHandlers";
import { HONDEGHEM } from "./weatherServices";

function favoriteFixture(id: number, lat: number, lon: number): FavoriteLocation {
  return {
    id,
    userId: id,
    lat,
    lon,
    name: `Lieu ${id}`,
    customName: null,
    localMode: "standard",
    isDefault: 0,
    position: 0,
    radiusKm: 20,
    preferredModels: null,
    tempUnit: "celsius",
    alertsEnabled: 1,
    alertThresholds: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("withDefaultCollectionLocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ajoute le lieu par défaut quand aucun favori n'existe (session anonyme)", () => {
    const locations = withDefaultCollectionLocation([]);
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({
      lat: HONDEGHEM.lat,
      lon: HONDEGHEM.lon,
      name: "Hondeghem",
      isDefault: 1,
    });
  });

  it("ne duplique pas le lieu par défaut quand un favori le couvre déjà", () => {
    const locations = withDefaultCollectionLocation([
      favoriteFixture(1, HONDEGHEM.lat, HONDEGHEM.lon),
    ]);
    expect(locations).toHaveLength(1);
    expect(locations[0]?.id).toBe(1);
  });

  it("déduplique les favoris par maille et conserve les lieux distincts", () => {
    const locations = withDefaultCollectionLocation([
      favoriteFixture(1, 48.8566, 2.3522),
      favoriteFixture(2, 48.85664, 2.35221),
      favoriteFixture(3, HONDEGHEM.lat, HONDEGHEM.lon),
    ]);
    expect(locations).toHaveLength(2);
    expect(locations.map((location) => location.id)).toEqual([1, 3]);
  });
});
