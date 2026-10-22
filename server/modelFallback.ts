type ModelReference = { name: string; temperature: number | null };

export type OfficialModelFallback = {
  temperature: number;
  modelCount: number;
  contributors: Array<{ name: string; temperature: number; weight: number }>;
  method: "official_trace_temperature_weights";
};

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function parseRecord(weights: unknown): Record<string, any> | null {
  let value = weights;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" ? value as Record<string, any> : null;
}

/**
 * Utilise uniquement les poids de température déjà appliqués par la fusion
 * officielle. Sans trace exploitable, aucun consensus égalitaire n’est inventé.
 */
export function buildOfficialModelFallback(references: ModelReference[], weights: unknown): OfficialModelFallback | null {
  const record = parseRecord(weights);
  if (!record) return null;
  const trace = record.trace && typeof record.trace === "object" ? record.trace : record;
  const traceSources = trace.parameterSources?.temperature;
  const legacySources = record.weightByService && typeof record.weightByService === "object"
    ? Object.entries(record.weightByService).map(([name, value]) => {
      const valueRecord = value && typeof value === "object" ? value as Record<string, unknown> : null;
      return { name, finalWeight: typeof value === "number" ? value : valueRecord?.tempWeight };
    })
    : [];
  const sources = Array.isArray(traceSources) ? traceSources : legacySources;
  const referencesByName = new Map(references.filter((reference) => reference.temperature != null).map((reference) => [normalizeName(reference.name), reference]));
  const weighted = sources
    .map((source: any) => {
      const reference = referencesByName.get(normalizeName(String(source?.name ?? "")));
      const weight = Number(source?.finalWeight);
      return reference && Number.isFinite(weight) && weight > 0
        ? { name: reference.name, temperature: reference.temperature!, weight }
        : null;
    })
    .filter((source): source is { name: string; temperature: number; weight: number } => source !== null);
  const totalWeight = weighted.reduce((sum, source) => sum + source.weight, 0);
  if (weighted.length < 2 || totalWeight <= 0) return null;
  const contributors = weighted.map((source) => ({ ...source, weight: source.weight / totalWeight }));
  const temperature = contributors.reduce((sum, source) => sum + source.temperature * source.weight, 0);
  return {
    temperature: Math.round(temperature * 10) / 10,
    modelCount: contributors.length,
    contributors: contributors.map((source) => ({ ...source, weight: Math.round(source.weight * 1000) / 1000 })),
    method: "official_trace_temperature_weights",
  };
}
