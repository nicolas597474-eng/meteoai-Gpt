export function getMeteoAIComparisonLabel(
  observedValue: number | null | undefined,
  forecastValue: number | null | undefined,
): string {
  if (observedValue == null) return "Observation indisponible";
  if (forecastValue == null) return "Comparaison indisponible";

  const absoluteGap = Math.abs(forecastValue - observedValue);
  if (!Number.isFinite(absoluteGap)) return "Comparaison indisponible";
  return `Écart MeteoAI ${absoluteGap.toFixed(1)}°C`;
}
