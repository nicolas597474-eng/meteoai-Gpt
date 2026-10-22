/**
 * AlertBadge — Indicateur visuel animé pour les signaux heuristiques de régime.
 * Le score de régime n'est ni une probabilité ni une confiance météo calibrée.
 */
import { MeteoIcon } from "@/components/MeteoIcon";

export type DangerousRegimeId = "thunderstorm" | "storm" | "summer_heat" | "freezing_rain" | "windy";

interface DangerousRegimeConfig {
  colorClass: string;
  bgClass: string;
  borderClass: string;
  pulseClass: string;
  meteoIconName: string;
  label: string;
}

const DANGEROUS_REGIMES: Record<DangerousRegimeId, DangerousRegimeConfig> = {
  thunderstorm: {
    colorClass: "text-red-300",
    bgClass: "bg-red-500/20",
    borderClass: "border-red-500/50",
    pulseClass: "animate-pulse",
    meteoIconName: "thunderstorm",
    label: "Signal de régime · Orage",
  },
  storm: {
    colorClass: "text-red-300",
    bgClass: "bg-red-500/20",
    borderClass: "border-red-500/50",
    pulseClass: "animate-pulse",
    meteoIconName: "storm",
    label: "Signal de régime · Tempête",
  },
  summer_heat: {
    colorClass: "text-orange-300",
    bgClass: "bg-orange-500/20",
    borderClass: "border-orange-500/50",
    pulseClass: "animate-pulse",
    meteoIconName: "summer_heat",
    label: "Signal de régime · Chaleur forte",
  },
  freezing_rain: {
    colorClass: "text-cyan-300",
    bgClass: "bg-cyan-500/20",
    borderClass: "border-cyan-500/50",
    pulseClass: "animate-pulse",
    meteoIconName: "freezing_rain",
    label: "Signal de régime · Verglas",
  },
  windy: {
    colorClass: "text-teal-300",
    bgClass: "bg-teal-500/20",
    borderClass: "border-teal-500/50",
    pulseClass: "animate-pulse",
    meteoIconName: "windy",
    label: "Signal de régime · Vent soutenu",
  },
};

const DANGEROUS_REGIME_IDS = new Set<string>(Object.keys(DANGEROUS_REGIMES));
const SCORE_EXPLANATION = "Score de régime heuristique non calibré : ce n’est ni une probabilité ni une confiance météorologique.";

interface AlertBadgeProps {
  /** ID du régime actif principal */
  regimeId: string;
  /** Score interne du régime (dominance ou couverture); une valeur absente masque l’indicateur. */
  regimeScore?: number | null;
  /** Seuil interne existant pour afficher l’indicateur (défaut: 60). */
  regimeScoreThreshold?: number;
  /** À fournir seulement si une source a explicitement typé la pluie verglaçante. */
  freezingRainPhaseConfirmed?: boolean;
  /** Taille compacte (pour les pills) ou normale */
  compact?: boolean;
}

export function isDangerousRegime(regimeId: string, freezingRainPhaseConfirmed = false): regimeId is DangerousRegimeId {
  if (regimeId === "freezing_rain") return freezingRainPhaseConfirmed;
  return DANGEROUS_REGIME_IDS.has(regimeId);
}

export function AlertBadge({ regimeId, regimeScore, regimeScoreThreshold = 60, freezingRainPhaseConfirmed = false, compact = false }: AlertBadgeProps) {
  if (!isDangerousRegime(regimeId, freezingRainPhaseConfirmed) || regimeScore == null) return null;
  if (regimeScore < regimeScoreThreshold) return null;

  const config = DANGEROUS_REGIMES[regimeId];

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold border ${config.bgClass} ${config.borderClass} ${config.colorClass} ${config.pulseClass}`}
        title={SCORE_EXPLANATION}
        aria-label={`${config.label}. ${SCORE_EXPLANATION}`}
      >
        <MeteoIcon name={config.meteoIconName} size={14} />
        <span>{config.label}</span>
      </span>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${config.bgClass} ${config.borderClass} ${config.pulseClass}`}
    >
      <div className={`weather-icon-bare flex items-center justify-center rounded-full p-1.5 ${config.bgClass}`}>
        <MeteoIcon name={config.meteoIconName} size={20} />
      </div>
      <div>
        <p className={`text-xs font-bold ${config.colorClass}`}>{config.label}</p>
        <p className="text-xs text-muted-foreground">{SCORE_EXPLANATION}</p>
      </div>
    </div>
  );
}

export default AlertBadge;
