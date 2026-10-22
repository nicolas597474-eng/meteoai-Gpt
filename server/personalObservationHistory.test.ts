import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("reconstruction de calibration personnelle", () => {
  it("rejoue les observations par ordre chronologique à partir des snapshots archivés", () => {
    const source = readFileSync(new URL("./personalObservationHistory.ts", import.meta.url), "utf8");
    expect(source).toContain("getAllPersonalWeatherObservations");
    expect(source).toContain("scorePersonalModelObservation");
    expect(source).toContain("replacePersonalModelObservationScores");
    expect(source).toContain("clearPersonalModelCalibrations");
    expect(source).toContain("precipitation: observation.precipitation");
    expect(source).toContain("precipitationScore: result.precipitationScore");
  });
});
