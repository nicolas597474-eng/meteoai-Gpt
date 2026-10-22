export const OFFICIAL_REGIME_INPUTS = [
  { key: "temperature", label: "Température", unit: "°C" },
  { key: "precipitation", label: "Précipitations", unit: "mm" },
  { key: "windSpeed", label: "Vent", unit: "km/h" },
  { key: "humidity", label: "Humidité", unit: "%" },
  { key: "cloudCover", label: "Nébulosité", unit: "%" },
  { key: "visibilityKm", label: "Visibilité", unit: "km" },
] as const;

export type RegimeInputKey = typeof OFFICIAL_REGIME_INPUTS[number]["key"];
export type RegimeInputStatus = "available" | "missing" | "invalid" | "stale";
export type RegimeInputSource =
  | "official_snapshot"
  | "fresh_observation"
  | "hourly_forecast"
  | "hourly_forecast_partial";

/** Diagnostic du seul enregistrement effectivement retenu par le sélecteur de régime. */
export type OfficialRegimeInputDiagnostic = {
  key: RegimeInputKey;
  label: string;
  unit: string;
  value: number | null;
  status: RegimeInputStatus;
  source: RegimeInputSource | null;
  sourceLabel: string | null;
  sourceUpdatedAt: string | null;
  validAt: string | null;
  sourceAgeMinutes: number | null;
};

export type RegimeInputCoverageSummary = {
  total: number;
  available: number;
  missing: number;
  invalid: number;
  stale: number;
  status: "complete" | "partial" | "none" | "unavailable";
};

/** Summarizes local regime inputs only; it is intentionally independent of collection-job health. */
export function summarizeRegimeInputCoverage(
  inputs: readonly Pick<OfficialRegimeInputDiagnostic, "key" | "status">[] | null | undefined,
): RegimeInputCoverageSummary {
  if (inputs == null) {
    return { total: OFFICIAL_REGIME_INPUTS.length, available: 0, missing: 0, invalid: 0, stale: 0, status: "unavailable" };
  }

  const byKey = new Map(inputs.map((input) => [input.key, input.status]));
  const counts = { available: 0, missing: 0, invalid: 0, stale: 0 };
  for (const { key } of OFFICIAL_REGIME_INPUTS) {
    const status = byKey.get(key) ?? "missing";
    counts[status] += 1;
  }
  const available = counts.available;
  return {
    total: OFFICIAL_REGIME_INPUTS.length,
    ...counts,
    status: available === OFFICIAL_REGIME_INPUTS.length
      ? "complete"
      : available > 0
        ? "partial"
        : "none",
  };
}
