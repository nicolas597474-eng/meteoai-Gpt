import { describe, expect, it } from "vitest";
import {
  isHourlyForecastArchiveComplete,
  isHourlyForecastRunHealthy,
} from "./forecastHealth";

describe("santé des prévisions horaires", () => {
  const completeRun = {
    isOfficialModel: true,
    status: "succeeded" as const,
    archiveRowsWritten: 300,
    expectedValueCount: 300,
    projectionRowsWritten: 48,
    expectedHoursCount: 48,
    resultJournaled: true,
  };

  it("sépare la couverture de l’archive principale de la santé complète du lot", () => {
    const archiveOnly = { archiveRowsWritten: 300, expectedValueCount: 300 };
    expect(isHourlyForecastArchiveComplete(archiveOnly)).toBe(true);
    expect(
      isHourlyForecastRunHealthy({ ...completeRun, resultJournaled: false })
    ).toBe(false);
    expect(isHourlyForecastRunHealthy(completeRun)).toBe(true);
  });

  it("ne traite pas quelques lignes archivées comme une série horaire complète", () => {
    const partialArchive = { archiveRowsWritten: 299, expectedValueCount: 300 };
    expect(isHourlyForecastArchiveComplete(partialArchive)).toBe(false);
    expect(
      isHourlyForecastRunHealthy({ ...completeRun, ...partialArchive })
    ).toBe(false);
  });

  it("ne compte pas un résultat avec projection incomplète ou statut partiel comme sain", () => {
    expect(
      isHourlyForecastRunHealthy({ ...completeRun, projectionRowsWritten: 47 })
    ).toBe(false);
    expect(
      isHourlyForecastRunHealthy({ ...completeRun, status: "partial" })
    ).toBe(false);
  });

  it("exclut Best Match et refuse les dénominateurs vides", () => {
    expect(
      isHourlyForecastRunHealthy({ ...completeRun, isOfficialModel: false })
    ).toBe(false);
    expect(
      isHourlyForecastArchiveComplete({
        archiveRowsWritten: 0,
        expectedValueCount: 0,
      })
    ).toBe(false);
  });
});
