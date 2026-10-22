export type SourceKindFilter = "all" | "physical" | "reference";
export type SourceStatusFilter = "all" | "active" | "ignored";
export type SourceDistanceOrder = "nearest" | "furthest";

export type StationSourceForFilter = {
  sourceKind: "physical" | "reference";
  isActive: boolean;
  distanceKm: number;
};

export function filterAndSortStationSources<T extends StationSourceForFilter>(
  sources: T[],
  kind: SourceKindFilter,
  status: SourceStatusFilter,
  distanceOrder: SourceDistanceOrder,
): T[] {
  const filtered = sources.filter((source) => {
    const matchingKind = kind === "all" || source.sourceKind === kind;
    const matchingStatus = status === "all" || (status === "active" ? source.isActive : !source.isActive);
    return matchingKind && matchingStatus;
  });
  return filtered.sort((left, right) => {
    const distanceDelta = Number(left.distanceKm) - Number(right.distanceKm);
    return distanceOrder === "nearest" ? distanceDelta : -distanceDelta;
  });
}
