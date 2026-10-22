import { describe, expect, it } from "vitest";
import { buildForecastAlignmentReport, getExpectedParisHourTimestamps, type ForecastAlignmentReadModel } from "./forecastAlignment";

function readModel(overrides: Partial<ForecastAlignmentReadModel> = {}): ForecastAlignmentReadModel {
  return {
    timeZone: "Europe/Paris",
    coordinates: { lat: 50.756, lon: 2.521 },
    assembledAt: "2026-10-02T17:02:00.000Z",
    currentSnapshotSource: { sourceKind: "model_current_snapshot", source: "open-meteo" },
    currentSnapshot: {
      sourceKind: "model_current_snapshot",
      source: "open-meteo",
      capturedAt: "2026-10-02T17:00:00.000Z",
      temp: 18.25,
    },
    hourlyForecast: {
      sourceKind: "official_forecast",
      source: "open-meteo",
      computedAt: "2026-10-02T17:01:00.000Z",
      modelsConsidered: ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"],
      bestMatchIncluded: false,
      points: [{
        date: "2026-10-02",
        hour: "19:00",
        validAt: Date.parse("2026-10-02T17:00:00.000Z"),
        temp: 19.5,
        finalValues: [{ variable: "temperature", value: 19.5, unit: "°C" }],
        modelsWithData: ["AROME", "ECMWF"],
      }],
    },
    dailyForecast: {
      source: "open-meteo",
      computedAt: "2026-10-02T17:02:00.000Z",
      modelsUsed: ["ECMWF", "GFS", "ICON", "Open-Meteo"],
      days: [{ date: "2026-10-02", tempMax: 21.4, tempMin: 12.1 }],
    },
    ...overrides,
  };
}

describe("AI Lab temperature alignment", () => {
  it("compares the model snapshot with an hourly forecast only at the exact same instant", () => {
    const result = buildForecastAlignmentReport(readModel(), { lat: 50.756, lon: 2.521 });

    expect(result.locationAligned).toBe(true);
    expect(result.snapshotVsHourly).toMatchObject({
      status: "comparable",
      snapshotTemp: 18.25,
      hourlyTemp: 19.5,
      difference: 1.25,
      hourlyAt: Date.parse("2026-10-02T17:00:00.000Z"),
    });
    expect(result.snapshotVsDaily).toMatchObject({
      status: "non_comparable",
      snapshotTemp: 18.25,
      dailyTempMin: 12.1,
      dailyTempMax: 21.4,
    });
  });

  it("shows different hourly instants but does not calculate a difference", () => {
    const model = readModel({
      hourlyForecast: {
        ...readModel().hourlyForecast,
        points: [{
          ...readModel().hourlyForecast.points[0],
          validAt: Date.parse("2026-10-02T18:00:00.000Z"),
          hour: "20:00",
          temp: 20.25,
        }],
      },
    });
    const result = buildForecastAlignmentReport(model);

    expect(result.snapshotVsHourly).toMatchObject({
      status: "non_comparable",
      snapshotTemp: 18.25,
      hourlyTemp: 20.25,
      difference: null,
    });
    expect(result.snapshotVsHourly.reason).toContain("instants de validité distincts");
  });

  it("compares hourly extrema with daily extrema only when every local-hour slot is present", () => {
    const date = "2026-10-03";
    const expected = getExpectedParisHourTimestamps(date);
    const model = readModel({
      currentSnapshot: null,
      hourlyForecast: {
        ...readModel().hourlyForecast,
        points: expected.map((validAt, index) => ({
          date,
          hour: new Date(validAt).toISOString().slice(11, 16),
          validAt,
          temp: 10 + index,
          finalValues: [{ variable: "temperature", value: 10 + index, unit: "°C" }],
          modelsWithData: ["AROME"],
        })),
      },
      dailyForecast: {
        ...readModel().dailyForecast,
        days: [{ date, tempMin: 10, tempMax: 33 }],
      },
    });
    const result = buildForecastAlignmentReport(model);

    expect(expected).toHaveLength(24);
    expect(result.hourlyVsDaily).toEqual([expect.objectContaining({
      date,
      status: "comparable",
      coveredHours: 24,
      expectedHours: 24,
      hourlyTempMin: 10,
      hourlyTempMax: 33,
      differenceMin: 0,
      differenceMax: 0,
    })]);
  });

  it("does not compare a partial local day and keeps the available extrema descriptive", () => {
    const date = "2026-10-03";
    const expected = getExpectedParisHourTimestamps(date);
    const model = readModel({
      currentSnapshot: null,
      hourlyForecast: {
        ...readModel().hourlyForecast,
        points: expected.slice(0, 23).map((validAt, index) => ({
          date,
          hour: String(index).padStart(2, "0") + ":00",
          validAt,
          temp: 10 + index,
          finalValues: [{ variable: "temperature", value: 10 + index, unit: "°C" }],
          modelsWithData: [],
        })),
      },
      dailyForecast: {
        ...readModel().dailyForecast,
        days: [{ date, tempMin: 10, tempMax: 32 }],
      },
    });
    const result = buildForecastAlignmentReport(model);

    expect(result.hourlyVsDaily[0]).toMatchObject({
      status: "non_comparable",
      coveredHours: 23,
      expectedHours: 24,
      hourlyTempMin: 10,
      hourlyTempMax: 32,
      differenceMin: null,
      differenceMax: null,
    });
  });

  it("accounts for the 23- and 25-hour Europe/Paris days at daylight-saving changes", () => {
    expect(getExpectedParisHourTimestamps("2026-03-29")).toHaveLength(23);
    expect(getExpectedParisHourTimestamps("2026-10-25")).toHaveLength(25);
    expect(getExpectedParisHourTimestamps("2026-02-30")).toEqual([]);
  });

  it("withholds all comparison values if the response belongs to a different active location", () => {
    const result = buildForecastAlignmentReport(readModel(), { lat: 48.8566, lon: 2.3522 });

    expect(result.locationAligned).toBe(false);
    expect(result.snapshotVsHourly).toMatchObject({ status: "non_comparable", snapshotTemp: null, hourlyTemp: null, difference: null });
    expect(result.hourlyVsDaily).toEqual([]);
    expect(result.unavailableReason).toContain("lieu actif");
  });
});
