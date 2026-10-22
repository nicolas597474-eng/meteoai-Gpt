import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("collecte horaire des snapshots physiques", () => {
  it("isole une erreur par favori et expose un statut partiel sans interrompre les autres lieux", () => {
    const source = readFileSync(resolve(process.cwd(), "server/scheduledHandlers.ts"), "utf8");

    expect(source).toContain("Physical snapshot collection failed for");
    expect(source).toContain("Physical snapshot collection failed after ${HOURLY_SNAPSHOT_MAX_ATTEMPTS} attempts for");
    expect(source).toContain("Erreur de collecte après relance : ${message}");
    expect(source).toContain("retrying (${attempt + 2}/${HOURLY_SNAPSHOT_MAX_ATTEMPTS}):");
    expect(source).toContain('status: allLocationsFailed ? "failed" : collectionErrors.length > 0 ? "partial" : "completed"');
    expect(source).toContain("countConsecutiveTechnicalFailures");
    expect(source).toContain("Échecs techniques horaires répétés");
    expect(source).toContain("newlyAlertableFailures");
    expect(source).toContain("await processWithConcurrency(Array.from(unique.values()), 2");
  });

  it("relance la recherche jusqu’à la limite lorsqu’aucune station physique qualifiée n’est disponible", () => {
    const source = readFileSync(resolve(process.cwd(), "server/scheduledHandlers.ts"), "utf8");

    expect(source).toContain("No qualified physical station for");
    expect(source).toContain("hasTemperature: synthesis.temperature != null");
    expect(source).toContain("if (synthesis.stationCount < 1 || synthesis.temperature == null)");
    expect(source).toContain("await new Promise<void>((resolve) => setTimeout(resolve, HOURLY_SNAPSHOT_RETRY_DELAY_MS));");
  });

  it("déclenche le nowcasting local sans pouvoir bloquer le snapshot", () => {
    const source = readFileSync(resolve(process.cwd(), "server/scheduledHandlers.ts"), "utf8");

    expect(source).toContain('import { rebuildLocalTemperatureNowcastForSnapshot } from "./localTemperatureNowcastingShadow"');
    expect(source).toContain('import { runOptionalBackgroundTask } from "./optionalBackgroundTask"');
    expect(source).toContain('await runOptionalBackgroundTask(`local-temperature-nowcast:${locationKey}:${date}:${hour}`');
    expect(source).toContain("rebuildLocalTemperatureNowcastForSnapshot({");
    expect(source).toContain("evaluateLocalPrecipitationNowcastOutcomesForSnapshot");
    expect(source).toContain('await runOptionalBackgroundTask(`local-precipitation-nowcast-outcome:${locationKey}:${date}:${hour}`');
    expect(source).toContain('await runOptionalBackgroundTask(`local-precipitation-nowcast:${locationKey}:${date}:${hour}`');
    expect(source).toContain("rebuildLocalPrecipitationNowcastForSnapshot({");
    expect(source).not.toContain("setInterval(");
  });
});
