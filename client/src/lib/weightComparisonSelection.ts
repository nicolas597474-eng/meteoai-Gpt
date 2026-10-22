export type WeightSnapshotOption = { id: number; date?: string };

export function resolveWeightComparisonSelection(
  history: readonly WeightSnapshotOption[],
  selectedBefore: number | null,
  selectedAfter: number | null,
) {
  const contains = (id: number | null) => id != null && history.some((snapshot) => snapshot.id === id);
  const afterId = contains(selectedAfter) ? selectedAfter : history[0]?.id ?? null;
  const after=history.find(snapshot=>snapshot.id===afterId);
  const sameDate=(snapshot:WeightSnapshotOption)=>!after?.date||snapshot.date===after.date;
  const beforeId = contains(selectedBefore) && sameDate(history.find(s=>s.id===selectedBefore)!) && selectedBefore !== afterId
    ? selectedBefore
    : history.find((snapshot) => snapshot.id !== afterId && sameDate(snapshot))?.id ?? null;

  return {
    beforeId,
    afterId,
    canCompare: beforeId != null && afterId != null && beforeId !== afterId,
  };
}
