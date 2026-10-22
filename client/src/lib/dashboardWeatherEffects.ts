export type DashboardWeatherEffectsMode = "full" | "reduced" | "off";

const STORAGE_KEY = "meteoai_dashboard_weather_effects";

type EffectsStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): EffectsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeDashboardWeatherEffectsMode(
  value: unknown
): DashboardWeatherEffectsMode {
  return value === "reduced" || value === "off" ? value : "full";
}

export function getDashboardWeatherEffectsMode(
  storage: EffectsStorage | null = browserStorage()
): DashboardWeatherEffectsMode {
  try {
    return normalizeDashboardWeatherEffectsMode(
      storage?.getItem(STORAGE_KEY)
    );
  } catch {
    return "full";
  }
}

export function storeDashboardWeatherEffectsMode(
  mode: DashboardWeatherEffectsMode,
  storage: EffectsStorage | null = browserStorage()
): void {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    // La préférence reste utilisable pour la session si le stockage est indisponible.
  }
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('meteoai-effects-changed',{detail:mode}));
}

export function getNextDashboardWeatherEffectsMode(
  mode: DashboardWeatherEffectsMode
): DashboardWeatherEffectsMode {
  if (mode === "full") return "reduced";
  if (mode === "reduced") return "off";
  return "full";
}

export function getDashboardWeatherEffectsModeLabel(
  mode: DashboardWeatherEffectsMode
): string {
  if (mode === "reduced") return "réduites";
  if (mode === "off") return "désactivées";
  return "complètes";
}
