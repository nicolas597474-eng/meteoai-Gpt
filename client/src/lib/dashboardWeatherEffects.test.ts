import { describe, expect, it } from "vitest";
import {
  getDashboardWeatherEffectsMode,
  getDashboardWeatherEffectsModeLabel,
  getNextDashboardWeatherEffectsMode,
  normalizeDashboardWeatherEffectsMode,
  storeDashboardWeatherEffectsMode,
} from "./dashboardWeatherEffects";

describe("préférence des effets météo du Dashboard", () => {
  it("valide les préférences enregistrées et retombe sur le mode complet", () => {
    expect(normalizeDashboardWeatherEffectsMode("reduced")).toBe("reduced");
    expect(normalizeDashboardWeatherEffectsMode("off")).toBe("off");
    expect(normalizeDashboardWeatherEffectsMode("unknown")).toBe("full");
    expect(getDashboardWeatherEffectsMode(null)).toBe("full");
  });

  it("enregistre et relit le mode choisi sans dépendre d’un stockage global", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    storeDashboardWeatherEffectsMode("reduced", storage);
    expect(getDashboardWeatherEffectsMode(storage)).toBe("reduced");
    storeDashboardWeatherEffectsMode("off", storage);
    expect(getDashboardWeatherEffectsMode(storage)).toBe("off");
  });

  it("parcourt les modes complet, réduit et désactivé", () => {
    expect(getNextDashboardWeatherEffectsMode("full")).toBe("reduced");
    expect(getNextDashboardWeatherEffectsMode("reduced")).toBe("off");
    expect(getNextDashboardWeatherEffectsMode("off")).toBe("full");
    expect(getDashboardWeatherEffectsModeLabel("full")).toBe("complètes");
    expect(getDashboardWeatherEffectsModeLabel("reduced")).toBe("réduites");
    expect(getDashboardWeatherEffectsModeLabel("off")).toBe("désactivées");
  });
});
