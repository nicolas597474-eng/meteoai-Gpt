import { describe, expect, it } from "vitest";
import { filterAndSortStationSources } from "../client/src/lib/stationSourceFilters";

const sources = [
  { id: "physical-active", sourceKind: "physical" as const, isActive: true, distanceKm: 8 },
  { id: "reference-near", sourceKind: "reference" as const, isActive: true, distanceKm: 1 },
  { id: "reference-ignored", sourceKind: "reference" as const, isActive: false, distanceKm: 3 },
];

describe("filterAndSortStationSources", () => {
  it("filtre les sources physiques actives et conserve le tri de proximité", () => {
    expect(filterAndSortStationSources(sources, "physical", "active", "nearest").map((source) => source.id)).toEqual(["physical-active"]);
  });

  it("filtre les sources écartées et permet un tri de la plus éloignée à la plus proche", () => {
    expect(filterAndSortStationSources(sources, "all", "ignored", "furthest").map((source) => source.id)).toEqual(["reference-ignored"]);
    expect(filterAndSortStationSources(sources, "all", "all", "furthest").map((source) => source.id)).toEqual(["physical-active", "reference-ignored", "reference-near"]);
  });
});
