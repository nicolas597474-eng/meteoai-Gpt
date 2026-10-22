import * as React from "react";

export type AltitudeCorrectionNoticeProps = {
  correction: { applied: boolean; reason: string } | null | undefined;
  isPlaceholderData?: boolean;
};

function describeAltitudeCorrection(correction: { applied: boolean; reason: string }): string {
  if (correction.applied) {
    return correction.reason === "adjustment_applied_with_unverifiable_stations"
      ? "Correction d’altitude appliquée aux stations dont l’altitude est connue; les autres relevés restent bruts."
      : "Correction d’altitude appliquée aux stations contributrices dont l’altitude est connue.";
  }

  switch (correction.reason) {
    case "reference_altitude_unavailable":
      return "Correction d’altitude non vérifiable : altitude cible inconnue; les relevés de stations sont conservés bruts.";
    case "station_altitude_unavailable":
      return "Correction d’altitude non vérifiable : altitude des stations contributrices inconnue; aucune correction n’est appliquée.";
    case "no_temperature_contributions":
      return "Aucune température de station contributrice : pas de correction d’altitude locale appliquée.";
    case "no_altitude_difference":
      return "Aucun écart d’altitude à corriger : les températures sont inchangées.";
    case "mode_disabled":
      return "Correction d’altitude non utilisée dans ce mode.";
    default:
      return "Correction d’altitude non appliquée; les températures sont conservées sans ajustement.";
  }
}

export function AltitudeCorrectionNotice({ correction, isPlaceholderData = false }: AltitudeCorrectionNoticeProps) {
  if (!correction || isPlaceholderData) return null;

  return (
    <p role="status" aria-label="État de la correction d’altitude" className="mt-2 rounded-lg border border-slate-600/50 bg-slate-950/30 px-2.5 py-2 text-[10px] leading-relaxed text-slate-300">
      {describeAltitudeCorrection(correction)}
    </p>
  );
}
