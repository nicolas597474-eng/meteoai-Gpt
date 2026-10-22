export type ForecastHorizonWindow = {
  key: "0_2h" | "2_6h" | "6_24h" | "1_3d" | "3_7d" | "7_15d";
  label: string;
  minMinutes: number;
  maxMinutes: number;
};

/**
 * Découpage stable des échéances utilisé par le scoring horaire et les archives
 * de prévision de l’application. Ce contrat est indépendant de l’ancien Data
 * Hub shadow P1–P8.
 */
export const FORECAST_HORIZON_WINDOWS: readonly ForecastHorizonWindow[] = [
  { key: "0_2h", label: "0 à 2 heures", minMinutes: 0, maxMinutes: 120 },
  { key: "2_6h", label: "2 à 6 heures", minMinutes: 120, maxMinutes: 360 },
  { key: "6_24h", label: "6 à 24 heures", minMinutes: 360, maxMinutes: 1_440 },
  { key: "1_3d", label: "1 à 3 jours", minMinutes: 1_440, maxMinutes: 4_320 },
  { key: "3_7d", label: "3 à 7 jours", minMinutes: 4_320, maxMinutes: 10_080 },
  { key: "7_15d", label: "7 à 15 jours", minMinutes: 10_080, maxMinutes: 21_600 },
];

export function getForecastHorizonWindow(forecastHorizonMinutes: number | null | undefined): ForecastHorizonWindow | null {
  if (forecastHorizonMinutes == null || !Number.isFinite(forecastHorizonMinutes) || forecastHorizonMinutes < 0) {
    return null;
  }
  return FORECAST_HORIZON_WINDOWS.find((window, index) => {
    const isLastWindow = index === FORECAST_HORIZON_WINDOWS.length - 1;
    return forecastHorizonMinutes >= window.minMinutes
      && (isLastWindow
        ? forecastHorizonMinutes <= window.maxMinutes
        : forecastHorizonMinutes < window.maxMinutes);
  }) ?? null;
}
