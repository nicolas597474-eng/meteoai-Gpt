import { describe, expect, it } from "vitest";
import {
  countConsecutiveTechnicalFailures,
  shouldNotifyOwnerForTechnicalFailures,
  TECHNICAL_FAILURE_ALERT_THRESHOLD,
} from "./scheduledHandlers";

describe("alerte de collecte physique consécutive", () => {
  it("compte seulement les échecs techniques les plus récents", () => {
    expect(countConsecutiveTechnicalFailures([
      { status: "failed" },
      { status: "failed" },
      { status: "failed" },
      { status: "stored" },
    ])).toBe(TECHNICAL_FAILURE_ALERT_THRESHOLD);
  });

  it("interrompt la série lorsqu’un passage stocké ou sans station est rencontré", () => {
    expect(countConsecutiveTechnicalFailures([{ status: "no_station" }, { status: "failed" }])).toBe(0);
    expect(countConsecutiveTechnicalFailures([{ status: "failed" }, { status: "stored" }, { status: "failed" }])).toBe(1);
  });

  it("demande une alerte unique exactement au troisième échec technique simulé", () => {
    expect(shouldNotifyOwnerForTechnicalFailures(2)).toBe(false);
    expect(shouldNotifyOwnerForTechnicalFailures(TECHNICAL_FAILURE_ALERT_THRESHOLD)).toBe(true);
    expect(shouldNotifyOwnerForTechnicalFailures(TECHNICAL_FAILURE_ALERT_THRESHOLD + 1)).toBe(false);
  });
});
