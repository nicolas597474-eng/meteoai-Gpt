import { describe, expect, it } from "vitest";
import { HOURLY_FORECAST_VARIABLES } from "./forecastVariableCoverage";
import { getLatestCompletePersonalHourlyForecasts, type ArchivedHourlyForecastValue } from "./personalHourlyForecast";
import { getParisHourlyTimestamps } from "./weatherTime";

const activeVariables = HOURLY_FORECAST_VARIABLES.filter((definition) => definition.consumerProjected);

function archiveRun(input: {
  modelName: string;
  captureRunId: string;
  availableAt: number;
  times: readonly number[];
  missing?: { validTime: number; variable: string };
  temperatureOffset?: number;
}): ArchivedHourlyForecastValue[] {
  return input.times.flatMap((validTime, index) => activeVariables.flatMap((definition) => {
    if (input.missing?.validTime === validTime && input.missing.variable === definition.key) return [];
    const base = definition.valueField === "temperature" ? 10 + index + (input.temperatureOffset ?? 0)
      : definition.valueField === "windDirection" ? 180
      : definition.valueField === "weatherCode" ? 3
      : 1;
    return [{
      captureRunId: input.captureRunId,
      modelName: input.modelName,
      availableAt: input.availableAt,
      validTime,
      variable: definition.key,
      value: base,
    }];
  }));
}

describe("reconstruction personnalisée des archives horaires exactes", () => {
  it("n'admet que les runs strictement disponibles avant la soumission", () => {
    const expectedValidTimes = getParisHourlyTimestamps("2026-10-04");
    const observedAt = Date.parse("2026-10-04T12:34:00.000Z");
    const archived = [
      ...archiveRun({ modelName: "AROME", captureRunId: "before", availableAt: observedAt - 1, times: expectedValidTimes }),
      ...archiveRun({ modelName: "AROME", captureRunId: "equal", availableAt: observedAt, times: expectedValidTimes, temperatureOffset: 100 }),
      ...archiveRun({ modelName: "AROME", captureRunId: "after", availableAt: observedAt + 1, times: expectedValidTimes, temperatureOffset: 200 }),
    ];

    const forecasts = getLatestCompletePersonalHourlyForecasts(archived, expectedValidTimes, observedAt);

    expect(new Set(forecasts.map((forecast) => forecast.captureRunId))).toEqual(new Set(["before"]));
    expect(forecasts.every((forecast) => forecast.availableAt < observedAt)).toBe(true);
  });

  it("n'expose aucun run au scoring si les seules archives sont disponibles à ou après l'observation", () => {
    const expectedValidTimes = getParisHourlyTimestamps("2026-10-04");
    const observedAt = Date.parse("2026-10-04T12:34:00.000Z");
    const archived = [
      ...archiveRun({ modelName: "GFS", captureRunId: "equal", availableAt: observedAt, times: expectedValidTimes }),
      ...archiveRun({ modelName: "ECMWF", captureRunId: "after", availableAt: observedAt + 1, times: expectedValidTimes }),
    ];

    const forecasts = getLatestCompletePersonalHourlyForecasts(archived, expectedValidTimes, observedAt);

    expect(forecasts).toEqual([]);
  });

  it("préserve les deux heures locales répétées et ignore un essai récent incomplet", () => {
    const expectedValidTimes = getParisHourlyTimestamps("2026-10-25");
    expect(expectedValidTimes).toHaveLength(25);
    const firstTwo = [Date.parse("2026-10-25T00:00:00.000Z"), Date.parse("2026-10-25T01:00:00.000Z")];
    const archived = [
      ...archiveRun({ modelName: "AROME", captureRunId: "arome-complete", availableAt: 100, times: expectedValidTimes }),
      ...archiveRun({
        modelName: "AROME",
        captureRunId: "arome-partial-newer",
        availableAt: 200,
        times: expectedValidTimes,
        missing: { validTime: expectedValidTimes.at(-1)!, variable: "weather_code" },
        temperatureOffset: 100,
      }),
      ...archiveRun({ modelName: "ECMWF", captureRunId: "ecmwf-complete", availableAt: 150, times: expectedValidTimes }),
    ];

    const forecasts = getLatestCompletePersonalHourlyForecasts(archived, expectedValidTimes);
    const repeatedHourForecasts = forecasts.filter((forecast) => forecast.hour === 2);
    expect(repeatedHourForecasts).toHaveLength(4);
    expect(new Set(repeatedHourForecasts.map((forecast) => forecast.validAt))).toEqual(new Set(firstTwo));
    expect(repeatedHourForecasts.filter((forecast) => forecast.modelName === "AROME").map((forecast) => forecast.temperature)).toEqual([12, 13]);
    expect(repeatedHourForecasts.every((forecast) => forecast.date === "2026-10-25")).toBe(true);
    expect(new Set(forecasts.map((forecast) => forecast.captureRunId))).toEqual(new Set(["arome-complete", "ecmwf-complete"]));
  });

  it("accepte les champs projetés complets même si des champs secondaires d’archive restent absents", () => {
    const expectedValidTimes = getParisHourlyTimestamps("2026-10-04");
    const archived = archiveRun({ modelName: "GFS", captureRunId: "gfs-active-fields-only", availableAt: 100, times: expectedValidTimes });

    const forecasts = getLatestCompletePersonalHourlyForecasts(archived, expectedValidTimes);

    expect(forecasts).toHaveLength(expectedValidTimes.length);
    expect(forecasts[0]).toMatchObject({ temperature: 10, precipitation: 1, windDirection: 180, weatherCode: 3 });
    expect(forecasts[0].rain).toBeNull();
  });
});
