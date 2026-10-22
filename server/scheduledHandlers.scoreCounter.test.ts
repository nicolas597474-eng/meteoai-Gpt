import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("analyse nocturne qualifiée", () => {
  it("additionne les scores réellement enregistrés dans le bilan du passage", () => {
    const source = readFileSync(new URL("./scheduledHandlers.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function collectObservationsHandler");
    const end = source.indexOf("function determineMajorityCondition", start);
    const handler = source.slice(start, end);

    expect(handler).toContain("totalScores += hourlyScores.length");
    expect(handler.indexOf("await insertReliabilityScores")).toBeLessThan(handler.indexOf("totalScores += hourlyScores.length"));
  });
});
