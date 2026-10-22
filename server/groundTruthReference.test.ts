import { describe, expect, it } from "vitest";
import { GROUND_TRUTH_REFERENCE_TOLERANCE, getGroundTruthReferenceBounds } from "./groundTruthReference";

describe("getGroundTruthReferenceBounds", () => {
  it("retrouve une synthèse écrite à la précision de collecte autour du lieu actif", () => {
    const requested = { lat: 50.7567, lon: 2.5204 };
    const stored = { lat: 50.75646, lon: 2.52085 };
    const latBounds = getGroundTruthReferenceBounds(requested.lat);
    const lonBounds = getGroundTruthReferenceBounds(requested.lon);

    expect(GROUND_TRUTH_REFERENCE_TOLERANCE).toBe(0.001);
    expect(stored.lat).toBeGreaterThanOrEqual(latBounds.min);
    expect(stored.lat).toBeLessThanOrEqual(latBounds.max);
    expect(stored.lon).toBeGreaterThanOrEqual(lonBounds.min);
    expect(stored.lon).toBeLessThanOrEqual(lonBounds.max);
  });
});
