import { describe, expect, it } from "vitest";
import { projectDailyForecastForDashboard } from "./forecastResponseProjection";
import type { DayForecast } from "./weatherServices";

describe("daily Dashboard projection", () => {
 it("keeps meteorology, agreement and source statuses while omitting bulky per-model weight traces", () => {
  // Synthetic contract fixture only; never stored as a real forecast.
  const day = { date: "2026-10-12", tempMax: 17, tempMin: null, precipitation: 0, windSpeed: 10, windGust: null, humidity: null, cloudCover: 20, condition: "Peu nuageux", modelAgreement: { availableModelCount: 7 }, bestMatchReference: null,
   officialFusion: { issuedAt: "2026-10-12T05:00:00Z", referenceAt: "2026-10-12T05:00:00Z", horizonBucket: "6-24h", availabilityStatus: {tempMax: "FUSED"}, calibrationStatus: {tempMax: "UNCALIBRATED_ROBUST"}, sourcesByVariable: {tempMax: [{modelName: "AROME", finalWeight: 0.2}]}, diagnosticsByVariable: {tempMax: {reason: "test trace"}} },
  } as unknown as DayForecast;
  const original = structuredClone(day);
  const [result] = projectDailyForecastForDashboard([day]);
  expect(result).toMatchObject({date: day.date, tempMax: 17, tempMin: null, precipitation: 0, modelAgreement: day.modelAgreement, officialFusion: {issuedAt: day.officialFusion.issuedAt, availabilityStatus: day.officialFusion.availabilityStatus, calibrationStatus: day.officialFusion.calibrationStatus}});
  expect(result.officialFusion).not.toHaveProperty("sourcesByVariable");
  expect(result.officialFusion).not.toHaveProperty("diagnosticsByVariable");
  expect(day).toEqual(original);
 });
});
