import { describe, expect, it } from "vitest";
import {
  getStationMeasurementAgeState,
  getValidStationMeasurementTimestamp,
  hasFreshStationMeasurement,
  evaluateStationFieldQuality,
} from "./stationMeasurementFreshness";

const now = Date.parse("2026-10-05T10:00:00.000Z");

describe("station measurement freshness", () => {
  it("uses only the timestamp belonging to the measured field", () => {
    const measurementTimes = {
      temperature: "2026-10-05T08:00:00.000Z",
      humidity: "2026-10-05T09:55:00.000Z",
    };

    expect(hasFreshStationMeasurement(measurementTimes, "temperature", 60, now)).toBe(false);
    expect(hasFreshStationMeasurement(measurementTimes, "humidity", 10, now)).toBe(true);
    expect(getStationMeasurementAgeState(measurementTimes, "humidity", now)).toEqual({
      observedAt: "2026-10-05T09:55:00.000Z",
      ageMinutes: 5,
      status: "known",
    });
  });

  it("reports missing, invalid and future timestamps as unknown", () => {
    expect(getStationMeasurementAgeState({}, "temperature", now)).toEqual({
      observedAt: null,
      ageMinutes: null,
      status: "unknown",
    });
    expect(getStationMeasurementAgeState({ temperature: "not-a-date" }, "temperature", now)).toEqual({
      observedAt: "not-a-date",
      ageMinutes: null,
      status: "unknown",
    });
    expect(getStationMeasurementAgeState({ temperature: "2026-10-05T10:00:01.000Z" }, "temperature", now)).toEqual({
      observedAt: "2026-10-05T10:00:01.000Z",
      ageMinutes: null,
      status: "unknown",
    });
    expect(getValidStationMeasurementTimestamp({ temperature: "not-a-date" }, "temperature", now)).toBeNull();
    expect(hasFreshStationMeasurement({ temperature: "not-a-date" }, "temperature", 60, now)).toBe(false);
  });

  it("keeps an observation at the established cutoff and excludes one just beyond it", () => {
    const atCutoff = new Date(now - 30 * 60_000).toISOString();
    const beyondCutoff = new Date(now - 30 * 60_000 - 1).toISOString();
    expect(hasFreshStationMeasurement({ temperature: atCutoff }, "temperature", 30, now)).toBe(true);
    expect(hasFreshStationMeasurement({ temperature: beyondCutoff }, "temperature", 30, now)).toBe(false);
  });

  it("qualifies a precipitation-only station only for precipitation without inventing primary values", () => {
    const source = {
      id: "rain-only",
      distanceKm: 1,
      reliabilityScore: 90,
      updatedAt: "2026-10-05T09:59:00.000Z",
      temperature: null,
      windSpeed: null,
      precipitation: 4.2,
      measurementTimes: { precipitation: "2026-10-05T09:59:00.000Z" },
    };
    const results = evaluateStationFieldQuality([source], "precipitation", {
      now,
      maxDistanceKm: 10,
      maxFreshnessMin: 60,
      minReliabilityScore: 40,
      maxTempDeviationC: 8,
    });

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].source.temperature).toBeNull();
    expect(results[0].source.windSpeed).toBeNull();
    expect(results[0].source.precipitation).toBe(4.2);
  });
});
