import { describe, expect, it } from "vitest";
import { detectAnomalies, type FusionSource } from "./fusionEngine";

function station(id: string, temperature: number, observedAt: string): FusionSource {
  return {
    id,
    name: id,
    distanceKm: 1,
    temperature,
    updatedAt: new Date(observedAt),
    measurementTimes: { temperature: observedAt },
    type: "station",
  };
}

describe("detectAnomalies — horodatages d’observation", () => {
  it("détecte un saut à partir du dt fournisseur même si l’enregistrement mémoire est plus ancien", () => {
    const now = Date.now();
    const previousAt = now - 15 * 60_000;
    const observedAt = now - 9 * 60_000;
    const result = detectAnomalies([
      station("target", 16, new Date(observedAt).toISOString()),
      station("peer", 16, new Date(now - 1).toISOString()),
    ], new Map([["target", { temperature: 10, timestamp: previousAt, stableSince: previousAt }]]), now);

    expect(result.reports.some((report) => report.sourceId === "target" && report.type === "sudden_jump")).toBe(true);
  });

  it("garde strictement dt <10 min et |ΔT| >5°C", () => {
    const now = Date.now();
    const cases = [
      { previousAt: now - 15 * 60_000, observedAt: now - 5 * 60_000, previousTemp: 10, temperature: 16 },
      { previousAt: now - 9 * 60_000, observedAt: now - 1 * 60_000, previousTemp: 10, temperature: 15 },
    ];

    for (const testCase of cases) {
      const result = detectAnomalies([
        station("target", testCase.temperature, new Date(testCase.observedAt).toISOString()),
        station("peer", testCase.temperature, new Date(now - 1).toISOString()),
      ], new Map([["target", {
        temperature: testCase.previousTemp,
        timestamp: testCase.previousAt,
        stableSince: testCase.previousAt,
      }]]), now);
      expect(result.reports.some((report) => report.type === "sudden_jump")).toBe(false);
    }
  });

  it("détecte une séquence identique après >60 min, mais pas à 60 min exactement", () => {
    const now = Date.now();
    const observedAt = now - 1;
    const lastObservationAt = now - 30 * 60_000;
    const current = station("stable", 20, new Date(observedAt).toISOString());
    const peer = station("peer", 20, new Date(observedAt).toISOString());
    const overThreshold = detectAnomalies([current, peer], new Map([["stable", {
      temperature: 20,
      timestamp: lastObservationAt,
      stableSince: now - 61 * 60_000,
    }]]), now);
    const exactThreshold = detectAnomalies([current, peer], new Map([["stable", {
      temperature: 20,
      timestamp: lastObservationAt,
      stableSince: observedAt - 60 * 60_000,
    }]]), now);

    expect(overThreshold.reports.some((report) => report.type === "frozen_value")).toBe(true);
    expect(exactThreshold.reports.some((report) => report.type === "frozen_value")).toBe(false);
  });

  it.each([null, "not-a-date"] as const)("n’invente pas de gel/saut sans timestamp fournisseur valide (%s)", (observedAt) => {
    const now = Date.now();
    const previousAt = now - 9 * 60_000;
    const target = station("unknown-time", 16, new Date(now - 1).toISOString());
    target.measurementTimes = { temperature: observedAt };
    const result = detectAnomalies([
      target,
      station("peer", 16, new Date(now - 1).toISOString()),
    ], new Map([["unknown-time", { temperature: 10, timestamp: previousAt, stableSince: previousAt }]]), now);

    expect(result.reports.some((report) => report.type === "sudden_jump" || report.type === "frozen_value")).toBe(false);
  });

  it("ignore une observation au timestamp répété sans la traiter comme une nouvelle mesure", () => {
    const now = Date.now();
    const previousAt = now - 9 * 60_000;
    const result = detectAnomalies([
      station("duplicate", 16, new Date(previousAt).toISOString()),
      station("peer", 16, new Date(now - 1).toISOString()),
    ], new Map([["duplicate", { temperature: 10, timestamp: previousAt, stableSince: previousAt }]]), now);

    expect(result.reports.some((report) => report.sourceId === "duplicate" && (report.type === "sudden_jump" || report.type === "frozen_value"))).toBe(false);
  });

  it("ignore une observation horodatée avant le dernier relevé accepté", () => {
    const now = Date.now();
    const previousAt = now - 9 * 60_000;
    const olderAt = previousAt - 1;
    const result = detectAnomalies([
      station("out-of-order", 16, new Date(olderAt).toISOString()),
      station("peer", 16, new Date(now - 1).toISOString()),
    ], new Map([["out-of-order", { temperature: 10, timestamp: previousAt, stableSince: previousAt }]]), now);

    expect(result.reports.some((report) => report.sourceId === "out-of-order" && (report.type === "sudden_jump" || report.type === "frozen_value"))).toBe(false);
  });
});
