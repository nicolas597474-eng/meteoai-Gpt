export type TraceWeightSource = {
  id: string;
  name: string;
  finalWeight: number;
};

export type TraceWeightSnapshot = {
  parameterSources?: {
    temperature?: TraceWeightSource[];
    precipitation?: TraceWeightSource[];
    wind?: TraceWeightSource[];
  };
};

export type WeightParameter = "temperature" | "precipitation" | "wind";

export function compareTraceWeights(before: TraceWeightSnapshot, after: TraceWeightSnapshot) {
  const parameters: WeightParameter[] = ["temperature", "precipitation", "wind"];
  return parameters.map((parameter) => {
    const previous = before.parameterSources?.[parameter] ?? [];
    const current = after.parameterSources?.[parameter] ?? [];
    const names = new Set([...previous.map((source) => source.name), ...current.map((source) => source.name)]);
    const sourceChanges = Array.from(names)
      .map((name) => {
        const previousSource = previous.find((source) => source.name === name);
        const currentSource = current.find((source) => source.name === name);
        const beforeWeight = previousSource?.finalWeight ?? 0;
        const afterWeight = currentSource?.finalWeight ?? 0;
        return {
          name,
          beforeWeight,
          afterWeight,
          delta: afterWeight - beforeWeight,
          status: previousSource == null ? "added" : currentSource == null ? "removed" : "retained",
        };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.name.localeCompare(b.name, "fr"));

    return { parameter, sourceChanges };
  });
}
