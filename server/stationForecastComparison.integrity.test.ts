import { describe, expect, it } from "vitest";
import { qualifyStationForecastReadings } from "./stationForecastComparison";
const at = Date.parse("2026-10-12T08:15:00Z");
const raw = { observedAt: at + 3600000, temperature: 12, windSpeed: 20, precipitation: 7, measurementTimes: { temperature: new Date(at).toISOString(), windSpeed: new Date(at + 3600000).toISOString(), precipitation: new Date(at).toISOString() } };
describe("station comparison own measurement integrity", () => {
 it("splits different field hours and never treats an unqualified accumulation as hourly rain", () => {
  expect(qualifyStationForecastReadings([raw], at + 3600000)).toEqual([
   { observedAt: at, temperature: 12, windSpeed: null, precipitation: null },
   { observedAt: at + 3600000, temperature: null, windSpeed: 20, precipitation: null },
  ]);
 });
 it("rejects unknown or future measurement times rather than substituting the receipt time", () => {
  expect(qualifyStationForecastReadings([{...raw, measurementTimes: null}], at + 3600000)).toEqual([]);
  expect(qualifyStationForecastReadings([{...raw, observedAt: at - 1}], at)).toEqual([]);
 });
 it("admits only an explicitly attested one-hour rain accumulation", () => {
  expect(qualifyStationForecastReadings([{...raw, precipitationPeriodHours: 1}], at + 3600000)[0].precipitation).toBe(7);
 });
});
