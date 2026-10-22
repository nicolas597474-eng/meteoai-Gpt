export type SourceKind = 'station' | 'model';
export type SourceSelectionKey = {kind: SourceKind; id: string; context: string};
export type SourceDetailsSelection = {kind: SourceKind; source: any} | null;

export function sourceSelectionKey(source: any, kind: SourceKind, context: string): SourceSelectionKey | null {
  const id = kind === 'station' ? source?.stationId : source?.id;
  return typeof id === 'string' && id.length > 0 ? {kind, id, context} : null;
}

/** La sélection ne conserve aucun relevé : la fenêtre suit le même cycle que la liste. */
export function resolveSourceSelection(selection: SourceSelectionKey | null, stations: any[], models: any[], context: string): SourceDetailsSelection {
  if (!selection || selection.context !== context) return null;
  const source = (selection.kind === 'station' ? stations : models).find(row =>
    (selection.kind === 'station' ? row.stationId : row.id) === selection.id);
  return source ? {kind: selection.kind, source} : null;
}

export function formatSourceNumber(value: unknown, unit = '', decimals = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(decimals)}${unit}` : '—';
}

export function formatSourceTimestamp(value: unknown) {
  const ms = typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('fr-FR', {timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short'}) : '—';
}

const fields = [
  ['temperature', 'Température'], ['humidity', 'Humidité'], ['pressure', 'Pression'],
  ['windSpeed', 'Vent'], ['windGust', 'Rafales'], ['precipitation', 'Précipitations'],
] as const;

/** Les poids hérités et leurs composantes sont propres à la température.
 * fieldWeights fournit les autres mesures, sans leur attribuer le poids de température. */
export function sourceDetailContribution(selection: SourceDetailsSelection, groundTruth: any) {
  const source = selection?.source;
  const contribution = selection?.kind === 'station' && typeof source?.stationId === 'string' && source?.isActive !== false
    ? groundTruth?.stationsUsed?.find((row: any) => row.stationId === source?.stationId) ?? null
    : null;
  const weights = contribution?.fieldWeights ?? (contribution ? {temperature: contribution.weight} : {});
  const fieldWeights = fields.flatMap(([field, label]) => {
    const weight = weights[field];
    return typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1
      ? [{field, label, weight}] : [];
  });
  const excluded = selection?.kind === 'station' && !contribution
    ? source?.exclusionReason ?? groundTruth?.stationsIgnored?.find((row: any) => row.stationId === source?.stationId)?.reason : null;
  return {contribution, fieldWeights, exclusionReason: typeof excluded === 'string' ? excluded : null, temperatureUsed: fieldWeights.some(row => row.field === 'temperature' && row.weight > 0)};
}
