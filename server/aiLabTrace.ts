type TraceSource = {
  name: string;
  type?: string;
  finalWeight: number;
};

export type ForecastTrace = {
  parameterSources?: {
    temperature?: TraceSource[];
    precipitation?: TraceSource[];
    wind?: TraceSource[];
    humidity?: TraceSource[];
  };
};

/** Remove non-official model sources from an official-engine trace without altering other source types. */
export function filterForecastTraceToModelNames(trace: ForecastTrace | null, officialModelNames: ReadonlySet<string>): ForecastTrace | null {
  if (!trace?.parameterSources) return trace;
  const filter = (sources: TraceSource[] | undefined) => sources?.filter((source) =>
    source.type !== "model" || officialModelNames.has(source.name),
  );
  return {
    ...trace,
    parameterSources: {
      ...trace.parameterSources,
      temperature: filter(trace.parameterSources.temperature),
      precipitation: filter(trace.parameterSources.precipitation),
      wind: filter(trace.parameterSources.wind),
      humidity: filter(trace.parameterSources.humidity),
    },
  };
}

export type AppliedModelWeight = {
  name: string;
  temperature: number | null;
  precipitation: number | null;
  wind: number | null;
  humidity: number | null;
  averageWeight: number;
};

/** Extrait seulement les modèles effectivement contributeurs de la trace finale. */
export function buildAppliedModelWeights(trace: ForecastTrace | null): AppliedModelWeight[] {
  if (!trace?.parameterSources) return [];
  const byName = new Map<string, Omit<AppliedModelWeight, "name" | "averageWeight">>();
  const register = (parameter: "temperature" | "precipitation" | "wind" | "humidity", sources: TraceSource[] | undefined) => {
    for (const source of sources ?? []) {
      if (source.type !== "model" || !Number.isFinite(source.finalWeight) || source.finalWeight <= 0) continue;
      const model = byName.get(source.name) ?? { temperature: null, precipitation: null, wind: null, humidity: null };
      model[parameter] = source.finalWeight;
      byName.set(source.name, model);
    }
  };

  register("temperature", trace.parameterSources.temperature);
  register("precipitation", trace.parameterSources.precipitation);
  register("wind", trace.parameterSources.wind);
  register("humidity", trace.parameterSources.humidity);

  return Array.from(byName.entries())
    .map(([name, weights]) => {
      const available = [weights.temperature, weights.precipitation, weights.wind, weights.humidity].filter((value): value is number => value !== null);
      return { name, ...weights, averageWeight: available.reduce((total, value) => total + value, 0) / available.length };
    })
    .sort((left, right) => right.averageWeight - left.averageWeight || left.name.localeCompare(right.name));
}
