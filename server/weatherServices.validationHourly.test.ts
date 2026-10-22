import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./weatherFetch", () => ({
  fetchWeather: vi.fn(),
  getWeatherResponseAttemptCount: vi.fn(() => 1),
}));

import { fetchWeather } from "./weatherFetch";
import { collectValidationHourlyForecasts, VALIDATION_WEATHER_MODELS } from "./weatherServices";

const mockedFetchWeather = vi.mocked(fetchWeather);
const unixTimes = [
  Date.parse("2026-10-04T12:00:00Z") / 1000,
  Date.parse("2026-10-04T13:00:00Z") / 1000,
  Date.parse("2026-10-04T14:00:00Z") / 1000,
];
const response = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
}) as Response;

describe("collectValidationHourlyForecasts variable availability", () => {
  beforeEach(() => {
    mockedFetchWeather.mockReset();
  });

  it("keeps a timestamp when any variable is valid, preserves zero, and excludes all-invalid hours", async () => {
    mockedFetchWeather.mockResolvedValue(response({
      hourly: {
        time: unixTimes,
        temperature_2m: [null, 0, Number.NaN],
        apparent_temperature: [16, null, null],
        precipitation: [0, null, null],
        wind_speed_10m: [4, null, null],
        wind_gusts_10m: [7, null, null],
        wind_direction_10m: [180, null, null],
        relative_humidity_2m: [70, null, null],
        cloud_cover: [30, null, null],
        weather_code: [2, null, null],
      },
    }));

    const forecasts = await collectValidationHourlyForecasts("2026-10-04", { lat: 50.7567, lon: 2.5204 });

    expect(forecasts).toHaveLength(VALIDATION_WEATHER_MODELS.length);
    for (const forecast of forecasts) {
      expect(forecast.hours.map((hour) => hour.validAt)).toEqual(unixTimes.slice(0, 2).map((value) => value * 1000));
      expect(forecast.hours[0]).toMatchObject({
        hour: 14,
        temperature: null,
        apparentTemperature: 16,
        precipitation: 0,
        windSpeed: 4,
        windGusts: 7,
        windDirection: 180,
        humidity: 70,
        cloudCover: 30,
        weatherCode: 2,
      });
      expect(forecast.hours[1]).toMatchObject({ hour: 15, temperature: 0 });
      expect(forecast.hours[1]?.precipitation).toBeNull();
    }
  });
});
