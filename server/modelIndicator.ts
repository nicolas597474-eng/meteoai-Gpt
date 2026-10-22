export type TraceSource = {
  name: string;
  type?: string;
  finalWeight: number;
};

export type ForecastTraceLike = {
  parameterSources?: {
    temperature?: TraceSource[];
    precipitation?: TraceSource[];
    wind?: TraceSource[];
  };
};

export type ModelIndicator = {
  mode: "single_model" | "multi_model";
  primaryModel: string;
  primaryWeight: number;
  modelCount: number;
  contributors: Array<{ name: string; averageWeight: number }>;
};

/**
 * Synthèse strictement dérivée de la trace des poids finaux. Elle ne choisit
 * jamais un modèle arbitraire : seuls les contributeurs de type `model` et
 * leurs poids réellement appliqués à la fusion sont retenus.
 */
export function buildModelIndicator(trace: ForecastTraceLike | null): ModelIndicator | null {
  if (!trace?.parameterSources) return null;
  const totals = new Map<string, { total: number; count: number }>();
  const groups = [
    trace.parameterSources.temperature ?? [],
    trace.parameterSources.precipitation ?? [],
    trace.parameterSources.wind ?? [],
  ];

  for (const group of groups) {
    for (const source of group) {
      if (source.type !== "model" || !Number.isFinite(source.finalWeight) || source.finalWeight <= 0) continue;
      const entry = totals.get(source.name) ?? { total: 0, count: 0 };
      entry.total += source.finalWeight;
      entry.count += 1;
      totals.set(source.name, entry);
    }
  }

  const contributors = Array.from(totals.entries())
    .map(([name, value]) => ({ name, averageWeight: value.total / value.count }))
    .sort((left, right) => right.averageWeight - left.averageWeight || left.name.localeCompare(right.name));
  const primary = contributors[0];
  if (!primary) return null;

  return {
    mode: contributors.length === 1 ? "single_model" : "multi_model",
    primaryModel: primary.name,
    primaryWeight: primary.averageWeight,
    modelCount: contributors.length,
    contributors,
  };
}
