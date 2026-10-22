import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStationCollectionSnapshot, getForecastCollectionJobStatus, getModelCoverage, isObservationScoringSlot, processWithConcurrency } from "./scheduledHandlers";
import { requireDatabaseForWrite } from "./db";
import { OFFICIAL_HOURLY_MODELS, VALIDATION_WEATHER_MODELS } from "./weatherServices";

describe("getModelCoverage", () => {
  it("conserve le catalogue quotidien à sept modèles officiels par défaut", () => {
    const coverage = getModelCoverage([
      "AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET", "Open-Meteo",
    ]);

    expect(coverage).toMatchObject({ expected: expect.any(Array), collected: expect.any(Array), missing: [] });
    expect(coverage.expected).toHaveLength(7);
    expect(coverage.expected).not.toContain("Open-Meteo");
  });

  it("identifie les sept modèles officiels attendus et les indisponibilités", () => {
    const coverage = getModelCoverage(["AROME", "ECMWF", "GEM"]);

    expect(coverage.expected).toHaveLength(7);
    expect(coverage.collected).toEqual(["AROME", "ECMWF", "GEM"]);
    expect(coverage.missing).toEqual(expect.arrayContaining(["ARPEGE", "ICON", "GFS", "UKMET"]));
    expect(coverage.missing).not.toContain("Open-Meteo");
  });

  it("ne signale aucune indisponibilité lorsque les sept modèles officiels sont présents", () => {
    const coverage = getModelCoverage([
      "AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET", "Open-Meteo",
    ]);

    expect(coverage.collected).toHaveLength(7);
    expect(coverage.missing).toEqual([]);
  });

  it("sépare le compte horaire des sept sources officielles de la référence Best Match", () => {
    const expectedOfficialModels = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
    const coverage = getModelCoverage([...expectedOfficialModels, "Open-Meteo"], expectedOfficialModels);

    expect(coverage.expected).toEqual(expectedOfficialModels);
    expect(coverage.collected).toEqual(expectedOfficialModels);
    expect(coverage.expected).not.toContain("Open-Meteo");
    expect(coverage.collected).not.toContain("Open-Meteo");
  });

  it("sépare aussi le compte quotidien officiel de la référence Best Match", () => {
    const expectedOfficialModels = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
    const coverage = getModelCoverage([...expectedOfficialModels, "Open-Meteo"], expectedOfficialModels);

    expect(coverage.expected).toHaveLength(7);
    expect(coverage.collected).toEqual(expectedOfficialModels);
    expect(coverage.expected).not.toContain("Open-Meteo");
    expect(coverage.collected).not.toContain("Open-Meteo");
  });

  it("conserve Best Match et les candidats hors du compteur de couverture active", () => {
    const coverage = getModelCoverage(["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET", "Open-Meteo"]);
    expect(coverage.expected).toHaveLength(7);
    expect(coverage.collected).toHaveLength(7);
    expect(coverage.collected).not.toContain("Open-Meteo");
    expect(VALIDATION_WEATHER_MODELS).toHaveLength(5);
    expect(coverage.expected).not.toContain("DMI HARMONIE-DINI");
  });
});

describe("cadence automatique des prévisions", () => {
  it("borne la concurrence des lieux tout en traitant chaque favori", async () => {
    const active: number[] = [];
    const processed: number[] = [];
    let peakConcurrency = 0;

    await processWithConcurrency([1, 2, 3, 4, 5], 2, async (location) => {
      active.push(location);
      peakConcurrency = Math.max(peakConcurrency, active.length);
      await new Promise((resolve) => setTimeout(resolve, 2));
      processed.push(location);
      active.splice(active.indexOf(location), 1);
    });

    expect(peakConcurrency).toBeLessThanOrEqual(2);
    expect(processed.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("relance uniquement les modèles incomplets et conserve la meilleure réponse par source", () => {
    const source = readFileSync(new URL("./weatherServices.ts", import.meta.url), "utf8");
    expect(source).toContain("Retry targeted for ${retryIndexes.length} incomplete model source(s)");
    expect(source).toContain("const retryIndexes = firstPass.map");
    expect(source).toContain("modelsToCollect.map((model) => collectModel(model, 2))");
    expect(source).toContain("retryIndexes.map((index) => collectModel(modelsToCollect[index], 1))");
    expect(source).toContain("const selected = retryProjectionReady !== firstProjectionReady");
    expect(source).toContain("retry.diagnostic.valuesReceived > first.diagnostic.valuesReceived");
    expect(source).toContain("forecasts: outcomes.flatMap");
  });

  it("délègue les relevés physiques à la tâche dédiée pour préserver le délai de prévision", () => {
    const source = readFileSync(new URL("./scheduledHandlers.ts", import.meta.url), "utf8");
    expect(source).toContain("const stationCollectionDeferred = true");
    expect(source).toContain("relevés physiques confiés à la collecte horaire dédiée");
    expect(source).toContain("getStationEvidenceSummary");
    expect(source).toContain("stations: stationEvidence");
  });

  it("distingue un succès complet, une collecte partielle et un échec total", () => {
    expect(getForecastCollectionJobStatus(2, [])).toBe("completed");
    expect(getForecastCollectionJobStatus(2, ["un des lieux a échoué"])).toBe("completed");
    expect(getForecastCollectionJobStatus(0, ["aucun lieu n’a abouti"])).toBe("failed");
  });

  it("garde les écritures sérialisées par lieu et ne compte que les modèles réellement persistés", () => {
    const source = readFileSync(new URL("./scheduledHandlers.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function collectFavoritesForecastsHandler");
    const end = source.indexOf("export async function collectPhysicalObservationSnapshotsForFavorites", start);
    const handler = source.slice(start, end);
    const dailyWrite = handler.indexOf("await insertForecasts(forecastRowsForLoc);");
    const dailyCounter = handler.indexOf("dailyModelsCollected += dailyCoverage.collected.length", dailyWrite);
    const hourlyWrite = handler.indexOf("const writeResult = await insertHourlyForecasts(rows, { refreshProjection: diagnostic.projectionReady });");
    const hourlyJournalWrite = handler.indexOf("await upsertHourlyForecastCollectionResults([", hourlyWrite);
    const hourlyCounter = handler.indexOf("hourlyModelsCollected++", hourlyWrite);

    expect(handler).toContain("getParisForecastSlot(new Date(), activeHours)");
    expect(handler).toContain("claimScheduledForecastCollectionJob(slot.key, user.taskUid)");
    expect(handler).toContain("FAVORITES_FORECAST_SCHEDULER_LOCK_KEY");
    expect(handler).toContain("getLocationForecastRefreshLockKey(locKey)");
    expect(handler).toContain("await upsertHourlyForecastCollectionResults(initialHourlyResults)");
    expect(handler).toContain("formatHourlyJournalWriteError(error)");
    expect(handler).toContain("non journalisé — ${errorDetails}");
    expect(handler).toContain("archiveRowsWritten = writeResult.archiveRowsWritten");
    expect(handler).toContain("expectedHourlyValidTimes = getParisHourlyTimestamps(today)");
    expect(handler).toContain("projectionReady: diagnostic.projectionReady");
    expect(handler).toContain("archiveValues: hour");
    expect(handler).toContain("{ refreshProjection: false }");
    expect(handler).toContain("OFFICIAL_HOURLY_COVERAGE_MODEL_SET.has(model.modelName)");
    expect(handler).toContain("hourlyModelsExpected = uniqueLocations.length * OFFICIAL_HOURLY_COVERAGE_MODELS.length");
    expect(handler.indexOf("collectHourlyForecastAllModelsWithDiagnostics(today")).toBeLessThan(handler.indexOf("if (expertData.length === 0)"));
    expect(dailyCounter).toBeGreaterThan(dailyWrite);
    expect(hourlyCounter).toBeGreaterThan(hourlyWrite);
    expect(hourlyCounter).toBeGreaterThan(hourlyJournalWrite);
    expect(handler).toContain("isHourlyForecastArchiveComplete");
    expect(handler).toContain("isHourlyForecastRunHealthy({");
    expect(handler).not.toContain("partial_archive_projection_published");
    expect(handler).toContain("partial_projection_published");
    expect(handler).toContain("partial_projection_retained");
    expect(handler).toContain("{ refreshComputedAt: true }");
    expect(handler).toContain("await insertForecastRuns(");
    expect(handler).not.toContain("cacheManualHourlyForecast");
    expect(handler).not.toContain("cacheOfficialCurrentWeather");
    expect(handler).not.toContain("tempCurrent");
  });

  it("borne aussi à deux lieux simultanés la collecte dédiée de snapshots physiques", () => {
    const source = readFileSync(new URL("./scheduledHandlers.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function collectPhysicalObservationSnapshotsForFavorites");
    const end = source.indexOf("export async function collectPhysicalObservationSnapshotsHandler", start);
    const physicalCollector = source.slice(start, end);

    expect(physicalCollector).toContain("await processWithConcurrency(Array.from(unique.values()), 2");
    expect(physicalCollector).toContain("async (favorite) =>");
  });
});

describe("créneau de scoring des observations", () => {
  it("accepte 00:30 Paris avec les deux offsets UTC, sans confondre le créneau suivant", () => {
    // CEST: 22:30Z la veille; CET: 23:30Z la veille. Les deux arrivent dans
    // le même créneau civil Paris et seront ensuite dédupliqués par date.
    expect(isObservationScoringSlot(new Date("2026-06-14T22:30:00.000Z"))).toBe(true);
    expect(isObservationScoringSlot(new Date("2026-01-14T23:30:00.000Z"))).toBe(true);
    expect(isObservationScoringSlot(new Date("2026-06-14T22:50:00.000Z"))).toBe(true);
    expect(isObservationScoringSlot(new Date("2026-06-14T22:51:00.000Z"))).toBe(false);
  });
});

describe("buildStationCollectionSnapshot", () => {
  it("conserve la preuve quotidienne par champ et compte sept modèles officiels malgré Best Match", () => {
    const officialModels = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
    const complete = getModelCoverage([...officialModels, "Open-Meteo"], officialModels);
    const dailyVariableCoverage = [{ modelName: "AROME", variables: [{ key: "relative_humidity_2m_mean", receivedCount: 2 }] }] as any;
    const snapshot = buildStationCollectionSnapshot({
      locationKey: "50.756_2.521",
      date: "2026-08-12",
      radiusKm: 30,
      physicalStationCount: 2,
      daily: complete,
      hourly: complete,
      dailyVariableCoverage,
    });

    expect(snapshot).toMatchObject({ radiusKm: 30, physicalStationCount: 2, dailyModelCount: 7, hourlyModelCount: 7, status: "completed" });
    expect(snapshot.dailyVariableCoverage).toEqual(dailyVariableCoverage);
  });

  it("distingue une couverture partielle et une indisponibilité totale", () => {
    const officialModels = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
    const partial = getModelCoverage(["AROME", "ECMWF"], officialModels);
    const partialSnapshot = buildStationCollectionSnapshot({ locationKey: "key", date: "2026-08-12", radiusKm: 20, physicalStationCount: 0, daily: partial, hourly: partial });
    const failedSnapshot = buildStationCollectionSnapshot({ locationKey: "key", date: "2026-08-12", radiusKm: 20, physicalStationCount: 0, daily: partial, hourly: partial, forceFailed: true });

    expect(partialSnapshot.status).toBe("partial");
    expect(partialSnapshot.dailyMissingModels).toHaveLength(5);
    expect(failedSnapshot.status).toBe("failed");
  });
});

describe("persistance stricte de la collecte legacy", () => {
  it("échoue explicitement lorsqu’une écriture requise ne dispose pas de base", () => {
    expect(() => requireDatabaseForWrite(null, "créer le journal de collecte")).toThrow(
      "Base de données indisponible : impossible de créer le journal de collecte.",
    );
    expect(() => requireDatabaseForWrite({}, "créer le journal de collecte")).not.toThrow();
  });

  it("exige les écritures quotidiennes et le journal avant toute réponse de succès", () => {
    const source = readFileSync(new URL("./scheduledHandlers.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function collectForecastsHandler");
    const end = source.indexOf("export async function collectObservationsHandler", start);
    const handler = source.slice(start, end);
    const jobCreation = handler.indexOf("const jobId = await createCollectionJob({");
    const forecastWrite = handler.indexOf("await insertForecasts(forecastRows, { requireDatabase: true });");
    const runWrite = handler.indexOf("await insertForecastRuns(buildForecastRunArchiveRows(expertData, defaultLocKey, today, issuedAt), { requireDatabase: true });");
    const fusionWrite = handler.indexOf("await upsertMeteoAIForecast({");
    const completedStatus = handler.indexOf('status: "completed"');
    const completedWrite = handler.indexOf("{ requireDatabase: true });", completedStatus);

    expect(handler).toContain("}, { requireDatabase: true });");
    expect(handler).toContain("if (jobId <= 0)");
    expect(handler).toContain("if (forecastRows.length === 0)");
    expect(handler.slice(jobCreation, forecastWrite)).toContain("{ requireDatabase: true }");
    expect(forecastWrite).toBeGreaterThan(-1);
    expect(runWrite).toBeGreaterThan(forecastWrite);
    expect(fusionWrite).toBeGreaterThan(runWrite);
    expect(handler.slice(fusionWrite, completedStatus)).toContain("}, { requireDatabase: true });");
    expect(completedStatus).toBeGreaterThan(fusionWrite);
    expect(completedWrite).toBeGreaterThan(completedStatus);
    expect(handler).not.toContain("applyBiasCorrection");
    expect(handler).not.toContain("getQualifiedCumulativeRankingForLocation");
    expect(handler).toContain("computeOfficialDailyForecast(rawForecastsForFusion");
  });

  it("garde les prévisions planifiées des favoris brutes pour la fusion et les nouvelles archives", () => {
    const source = readFileSync(new URL("./scheduledHandlers.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function collectFavoritesForecastsHandler");
    const end = source.indexOf("export async function collectPhysicalObservationSnapshotsForFavorites", start);
    const handler = source.slice(start, end);

    expect(handler).not.toContain("applyBiasCorrection");
    expect(handler).not.toContain("getQualifiedCumulativeRankingForLocation");
    expect(handler).not.toContain("locBiases");
    expect(handler).not.toContain("biasCorrectedLocForecasts");
    expect(handler).toContain("buildForecastRunArchiveRows(expertData, locKey, today, issuedAt)");
    expect(handler).toContain("computeOfficialDailyForecast(rawLocForecasts");
  });

  it("écrit le snapshot dans le traitement planifié après le calcul des diagnostics horaires", () => {
    const source = readFileSync(new URL("./scheduledHandlers.ts", import.meta.url), "utf8");
    const handlerStart = source.indexOf("export async function collectObservationsHandler");
    const handlerEnd = source.indexOf("export async function collectPhysicalObservationSnapshotsHandler", handlerStart);
    const scheduledHandler = source.slice(handlerStart, handlerEnd);
    const loopStart = scheduledHandler.indexOf("for (const loc of uniqueLocations) {");
    const loopEnd = scheduledHandler.indexOf("} catch (err: any) {", loopStart);
    const perLocation = scheduledHandler.slice(loopStart, loopEnd);
    const evaluation = perLocation.indexOf("const evaluation = evaluateHourlyForecastRuns(");
    const snapshotWrite = perLocation.indexOf("await upsertHourlyComparisonDiagnosticSnapshot(", evaluation);
    const scorePersistence = perLocation.indexOf("const hourlyScores =", evaluation);

    expect(perLocation).toContain("comparisonDiagnostics.push(...providerRunEvaluation.diagnostics)");
    expect(perLocation).toContain("comparisonDiagnostics.push(...evaluation.diagnostics)");
    expect((perLocation.match(/await upsertHourlyComparisonDiagnosticSnapshot\(/g) ?? []).length).toBe(2);
    expect(snapshotWrite).toBeGreaterThan(evaluation);
    expect(snapshotWrite).toBeLessThan(scorePersistence);
  });
});
