export type ExtremeTemperatureKind = "max" | "min";

export type ExtremeTemperatureTone = {
  level: "mild" | "warm" | "hot" | "extremeHeat" | "cool" | "frostRisk" | "freezing" | "severeFreeze";
  container: string;
  label: string;
  value: string;
};

const MAX_TONES: Record<"mild" | "warm" | "hot" | "extremeHeat", ExtremeTemperatureTone> = {
  mild: {
    level: "mild",
    container: "border-amber-200/70 bg-gradient-to-r from-amber-500/78 via-amber-500/40 to-amber-500/12",
    label: "text-amber-50",
    value: "text-amber-50",
  },
  warm: {
    level: "warm",
    container: "border-orange-200/80 bg-gradient-to-r from-orange-500/88 via-orange-500/48 to-orange-500/14",
    label: "text-orange-50",
    value: "text-orange-50",
  },
  hot: {
    level: "hot",
    container: "border-orange-100/90 bg-gradient-to-r from-red-600/94 via-orange-500/62 to-orange-500/18",
    label: "text-white",
    value: "text-white",
  },
  extremeHeat: {
    level: "extremeHeat",
    container: "border-red-100/95 bg-gradient-to-r from-red-700/96 via-red-600/70 to-orange-500/22",
    label: "text-white",
    value: "text-white",
  },
};

const MIN_TONES: Record<"cool" | "frostRisk" | "freezing" | "severeFreeze", ExtremeTemperatureTone> = {
  cool: {
    level: "cool",
    container: "border-cyan-200/80 bg-gradient-to-r from-blue-500/88 via-sky-500/48 to-sky-500/14",
    label: "text-cyan-50",
    value: "text-cyan-50",
  },
  frostRisk: {
    level: "frostRisk",
    container: "border-sky-100/90 bg-gradient-to-r from-sky-600/94 via-sky-500/62 to-sky-500/18",
    label: "text-white",
    value: "text-white",
  },
  freezing: {
    level: "freezing",
    container: "border-cyan-50/95 bg-gradient-to-r from-cyan-600/96 via-blue-500/70 to-blue-500/22",
    label: "text-white",
    value: "text-white",
  },
  severeFreeze: {
    level: "severeFreeze",
    container: "border-white bg-gradient-to-r from-indigo-700/96 via-blue-600/72 to-cyan-400/24",
    label: "text-white",
    value: "text-white",
  },
};

export function getExtremeTemperatureTone(kind: ExtremeTemperatureKind, temperature: number | string | null | undefined): ExtremeTemperatureTone {
  const value = typeof temperature === "number" ? temperature : Number(temperature);
  if (!Number.isFinite(value)) return kind === "max" ? MAX_TONES.mild : MIN_TONES.cool;

  if (kind === "max") {
    if (value > 33) return MAX_TONES.extremeHeat;
    if (value >= 30) return MAX_TONES.hot;
    if (value >= 25) return MAX_TONES.warm;
    return MAX_TONES.mild;
  }

  if (value < -5) return MIN_TONES.severeFreeze;
  if (value < 0) return MIN_TONES.freezing;
  if (value <= 5) return MIN_TONES.frostRisk;
  return MIN_TONES.cool;
}
