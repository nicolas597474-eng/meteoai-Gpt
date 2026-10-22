import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WINDY_MAP_PREFERENCES,
  WINDY_MAP_PREFERENCES_STORAGE_KEY,
  getWindyMapPreferences,
  makeLegacyWindyMapLocationKey,
  makeWindyMapLocationKey,
  readWindyMapPreferences,
  writeWindyMapPreferences,
} from "./windyMapPreferences";

type MemoryStorage = Storage & { clear: () => void };

function createMemoryStorage(): MemoryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as MemoryStorage;
}

describe("windyMapPreferences", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = createMemoryStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("isole les favoris par identifiant et garde des coordonnées précises hors favori", () => {
    expect(makeWindyMapLocationKey(50.912345, 2.412356, 42)).toBe("favorite:42");
    expect(makeWindyMapLocationKey(50.912345, 2.412356)).toBe("coordinates:50.912345,2.412356");
    expect(makeWindyMapLocationKey(50.912346, 2.412356)).not.toBe(makeWindyMapLocationKey(50.912345, 2.412356));
    expect(makeLegacyWindyMapLocationKey(50.912345, 2.412356)).toBe("50.9123,2.4124");
  });

  it("retourne les réglages par défaut lorsqu’aucun lieu n’est encore mémorisé", () => {
    expect(getWindyMapPreferences("favorite:42")).toEqual(DEFAULT_WINDY_MAP_PREFERENCES);
  });

  it("conserve séparément la couche et les deux zooms pour chaque lieu", () => {
    writeWindyMapPreferences("lieu-a", { layer: "wind", compactZoom: 10, fullscreenZoom: 12 });
    writeWindyMapPreferences("lieu-b", { layer: "clouds", compactZoom: 6, fullscreenZoom: 7 });

    expect(getWindyMapPreferences("lieu-a")).toEqual({ layer: "wind", compactZoom: 10, fullscreenZoom: 12 });
    expect(getWindyMapPreferences("lieu-b")).toEqual({ layer: "clouds", compactZoom: 6, fullscreenZoom: 7 });
    expect(storage.getItem(WINDY_MAP_PREFERENCES_STORAGE_KEY)).toContain("lieu-a");
  });

  it("ignore les valeurs invalides et borne les niveaux de zoom relus", () => {
    storage.setItem(
      WINDY_MAP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ lieu: { layer: "inconnu", compactZoom: 99, fullscreenZoom: 1 } }),
    );

    expect(readWindyMapPreferences().lieu).toEqual({ layer: "rain", compactZoom: 11, fullscreenZoom: 3 });
  });

  it("reste tolérant à un contenu JSON corrompu", () => {
    storage.setItem(WINDY_MAP_PREFERENCES_STORAGE_KEY, "pas-du-json");
    expect(readWindyMapPreferences()).toEqual({});
  });

  it("migre une préférence legacy sans faire collisionner deux favoris proches", () => {
    const legacyKey = makeLegacyWindyMapLocationKey(50.912345, 2.412356);
    writeWindyMapPreferences(legacyKey, { layer: "wind", compactZoom: 10, fullscreenZoom: 12 });

    expect(getWindyMapPreferences("favorite:101", legacyKey)).toEqual({ layer: "wind", compactZoom: 10, fullscreenZoom: 12 });
    writeWindyMapPreferences("favorite:102", { layer: "clouds", compactZoom: 6, fullscreenZoom: 7 });

    expect(getWindyMapPreferences("favorite:101")).toEqual({ layer: "wind", compactZoom: 10, fullscreenZoom: 12 });
    expect(getWindyMapPreferences("favorite:102")).toEqual({ layer: "clouds", compactZoom: 6, fullscreenZoom: 7 });
  });
});
