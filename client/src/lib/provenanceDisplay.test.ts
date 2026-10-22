import { describe, expect, it } from "vitest";
import {
  PROVENANCE_DISPLAY_STORAGE_KEY,
  getProvenanceDisplayMode,
  getProvenanceDisplayModeLabel,
  normalizeProvenanceDisplayMode,
  storeProvenanceDisplayMode,
  storeProvenanceDisplayVisibility,
} from "./provenanceDisplay";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("préférence d’affichage de la provenance météo", () => {
  it("affiche la provenance par défaut, y compris sans stockage ni valeur connue", () => {
    expect(normalizeProvenanceDisplayMode("shown")).toBe("shown");
    expect(normalizeProvenanceDisplayMode("hidden")).toBe("hidden");
    expect(normalizeProvenanceDisplayMode("unknown")).toBe("shown");
    expect(normalizeProvenanceDisplayMode(null)).toBe("shown");
    expect(getProvenanceDisplayMode(null)).toBe("shown");
  });

  it("enregistre et relit le réglage sans dépendre d’un stockage global", () => {
    const storage = memoryStorage();

    expect(getProvenanceDisplayMode(storage)).toBe("shown");

    storeProvenanceDisplayMode("hidden", storage);
    expect(getProvenanceDisplayMode(storage)).toBe("hidden");

    storeProvenanceDisplayVisibility(true, storage);
    expect(getProvenanceDisplayMode(storage)).toBe("shown");

    storeProvenanceDisplayVisibility(false, storage);
    expect(getProvenanceDisplayMode(storage)).toBe("hidden");
  });

  it("utilise une clé de stockage dédiée et n’écrase pas celle des effets 3D", () => {
    const storage = memoryStorage();
    storeProvenanceDisplayMode("hidden", storage);

    expect(storage.values.get(PROVENANCE_DISPLAY_STORAGE_KEY)).toBe("hidden");
    expect(PROVENANCE_DISPLAY_STORAGE_KEY).not.toBe(
      "meteoai_dashboard_weather_effects"
    );
    expect(storage.values.has("meteoai_dashboard_weather_effects")).toBe(false);
  });

  it("libelle le réglage sans ambiguïté", () => {
    expect(getProvenanceDisplayModeLabel("shown")).toBe("affichée");
    expect(getProvenanceDisplayModeLabel("hidden")).toBe("masquée");
  });

  it("reste utilisable si le stockage lève une exception", () => {
    const failingStorage = {
      getItem: () => {
        throw new Error("stockage indisponible");
      },
      setItem: () => {
        throw new Error("stockage indisponible");
      },
    };

    expect(getProvenanceDisplayMode(failingStorage)).toBe("shown");
    expect(() =>
      storeProvenanceDisplayMode("hidden", failingStorage)
    ).not.toThrow();
  });
});
