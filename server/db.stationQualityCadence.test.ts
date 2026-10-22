import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cadence des profils qualité des stations", () => {
  it("espace les recalculs et borne les écritures concurrentes", () => {
    const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function refreshStationQualityProfiles");
    const end = source.indexOf("export async function getStationQualityProfiles", start);
    const helper = source.slice(start, end);

    expect(helper).toContain("const refreshIntervalMs = 6 * 60 * 60 * 1000");
    expect(helper).toContain("const dueIds = uniqueIds.filter");
    expect(helper).toContain("const writeConcurrency = 12");
    expect(helper).toContain("onDuplicateKeyUpdate");
  });
});
