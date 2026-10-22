import { describe, expect, it } from "vitest";
import { buildLiveAILabSnapshot } from "./aiLabLiveSnapshot";
import { getDailyForecastValidTime } from "./dailyForecastVerification";

describe("buildLiveAILabSnapshot", () => {
  const referenceAt = Date.parse("2026-08-18T05:00:00.000Z");
  const validTime = getDailyForecastValidTime("2026-08-18");
  const models = [
    { serviceName: "AROME", modelId: "meteofrance_arome_france_hd", sourceName: "open-meteo", runId: "arome-capture", runIdKind: "capture" as const, requestStartedAt: referenceAt - 60_000, availableAt: referenceAt, validTime, qualityStatus: "unknown" as const, tempMax: 20, tempMin: 11, precipitation: 1, windSpeed: 10, windGust: 18, humidity: 70, cloudCover: 55, condition: "Nuageux" },
    { serviceName: "ECMWF", modelId: "ecmwf_ifs025", sourceName: "open-meteo", runId: "ecmwf-capture", runIdKind: "capture" as const, requestStartedAt: referenceAt - 60_000, availableAt: referenceAt, validTime, qualityStatus: "unknown" as const, tempMax: 20.4, tempMin: 11.2, precipitation: 1.2, windSpeed: 11, windGust: 19, humidity: 71, cloudCover: 57, condition: "Nuageux" },
  ];

  it("produit une trace de modèles pour une position non archivée", () => {
    const snapshot = buildLiveAILabSnapshot("2026-08-18", models, new Date(referenceAt));
    expect(snapshot?.weights.trace.sourceCount).toBe(2);
    expect(snapshot?.weights.trigger).toBe("live-position");
    expect(snapshot).not.toHaveProperty("confidenceScore");
    expect(snapshot?.weights.trace.availabilityStatus.temperature_max).toBe("FUSED");
    expect(snapshot?.weights.trace.calibrationStatus.tempMax).toBe("UNCALIBRATED_ROBUST");
    expect(snapshot?.tempMax).not.toBeNull();
    expect(snapshot?.tempMax).toBeGreaterThanOrEqual(20);
    expect(snapshot?.tempMax).toBeLessThanOrEqual(20.4);
    expect(snapshot).not.toHaveProperty("stabilityIndex");
  });

  it("ne crée pas de snapshot lorsque les modèles sont indisponibles", () => {
    expect(buildLiveAILabSnapshot("2026-08-18", [])).toBeNull();
  });
});
