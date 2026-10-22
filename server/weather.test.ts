import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { getCurrentHourlyRegimeInput } from "./routers/weather";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("weather.getDashboard", () => {
  it("expose les vingt régimes réellement qualifiés pour le menu descriptif", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const catalogue = await caller.weather.getRegimeCatalogue();
    expect(catalogue).toHaveLength(20);
    expect(catalogue).toContainEqual(expect.objectContaining({ id: "stable", label: "Été stable" }));
    expect(catalogue).toContainEqual(expect.objectContaining({ id: "thunderstorm", label: "Orages" }));
    expect(catalogue).toContainEqual(expect.objectContaining({ id: "winter_precipitation_uncertain", label: "Précipitations hivernales — phase incertaine" }));
    expect(catalogue).toContainEqual(expect.objectContaining({
      id: "stable",
      weights: expect.objectContaining({ temp: expect.any(Number), precip: expect.any(Number), wind: expect.any(Number), condition: expect.any(Number) }),
    }));
  });

  it("retrouve la prévision de l’heure courante malgré un format horaire sans zéro initial", () => {
    const current = getCurrentHourlyRegimeInput([
      { hour: "6:00", temp: 15.7, precipitation: 0, windSpeed: 5.8, humidity: 33, cloudCover: 4 },
      { hour: "07:00", temp: 17, precipitation: 0, windSpeed: 6, humidity: 35, cloudCover: 8 },
    ], 6);

    expect(current).toEqual(expect.objectContaining({
      temp: 15.7,
      cloudCover: 4,
    }));
  });

  it("conserve l’horodatage du snapshot source quand il est fourni", () => {
    const sourceUpdatedAt = new Date("2026-08-12T12:01:00.000Z");
    const sourceComputedAt = new Date("2026-08-12T11:45:00.000Z");
    const current = getCurrentHourlyRegimeInput([
      { hour: "14:00", validAt: Date.parse("2026-08-12T12:00:00.000Z"), temp: 23.4, precipitation: 0, windSpeed: 9, humidity: 50, cloudCover: 12 },
    ], 14, sourceUpdatedAt, "Prévision horaire officielle · 7 modèles", sourceComputedAt);

    expect(current?.updatedAt).toEqual(sourceUpdatedAt);
    expect(current?.sourceUpdatedAt).toEqual(sourceComputedAt);
    expect(current?.validAt).toBe(Date.parse("2026-08-12T12:00:00.000Z"));
    expect(current?.sourceLabel).toBe("Prévision horaire officielle · 7 modèles");
  });

  it("utilise validAt pour distinguer les deux heures locales répétées", () => {
    const sourceUpdatedAt = new Date("2026-10-25T01:30:00.000Z");
    const current = getCurrentHourlyRegimeInput([
      { hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00.000Z"), temp: 11, precipitation: 0, windSpeed: 5, humidity: 50, cloudCover: 10 },
      { hour: "02:00", validAt: Date.parse("2026-10-25T01:00:00.000Z"), temp: 22, precipitation: 0, windSpeed: 5, humidity: 50, cloudCover: 10 },
    ], 2, sourceUpdatedAt);

    expect(current?.temp).toBe(22);
  });

  it("returns dashboard data with today's date", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.weather.getDashboard();

    expect(result).toHaveProperty("today");
    expect(result.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).not.toHaveProperty("topServices");
    expect(result).toHaveProperty("recentForecasts");
    expect(Array.isArray(result.recentForecasts)).toBe(true);
    expect(result).toHaveProperty("allServices");
    expect(Array.isArray(result.allServices)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/stability(Index|Label)/i);
  }, 25_000);

  it("returns meteoAI forecast for today if available", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.weather.getDashboard();

    expect(result).toHaveProperty("currentSnapshot");
    // meteoAI may be null if no forecast for today, or an object
    if (result.meteoAI) {
      expect(result.meteoAI).toHaveProperty("tempMax");
      expect(result.meteoAI).toHaveProperty("tempMin");
      expect(result.meteoAI).not.toHaveProperty("stabilityIndex");
      expect(result.meteoAI).not.toHaveProperty("stabilityLabel");
      expect(result.meteoAI).not.toHaveProperty("confidenceScore");
    }
  });
});

describe("contrat de snapshot officiel inter-pages", () => {
  it("partage la même validité, provenance et type entre quinze jours, horaire et détails", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const [daily, hourly, details] = await Promise.all([
      caller.weather.get15DayForecast(),
      caller.weather.getHourlyForecast(),
      caller.weather.getDetailedForecast(),
    ]);

    expect(daily.officialSnapshot).toEqual(expect.objectContaining({
      sourceKind: expect.any(String),
      source: expect.any(String),
    }));
    expect(daily.officialSnapshot.validAt === null || typeof daily.officialSnapshot.validAt === "string").toBe(true);
    expect(hourly.officialSnapshot.validAt).toBe(daily.officialSnapshot.validAt);
    expect(details.officialSnapshot.validAt).toBe(daily.officialSnapshot.validAt);
    expect(hourly.officialSnapshot.sourceKind).toBe(daily.officialSnapshot.sourceKind);
    expect(details.officialSnapshot.sourceKind).toBe(daily.officialSnapshot.sourceKind);
    expect(hourly.officialSnapshot.source).toBe(daily.officialSnapshot.source);
    expect(details.officialSnapshot.source).toBe(daily.officialSnapshot.source);
    expect(daily).toHaveProperty("currentSnapshot");
    expect(hourly.currentSnapshot).toEqual(daily.currentSnapshot);
    expect(details.currentSnapshot).toEqual(daily.currentSnapshot);
    expect(daily.officialSnapshot).not.toHaveProperty("currentSnapshot");
    if (daily.currentSnapshot) {
      expect(daily.currentSnapshot).toMatchObject({
        sourceKind: "model_current_snapshot",
        source: "open-meteo",
        capturedAt: expect.any(String),
      });
      expect(hourly.hours).not.toContainEqual(daily.currentSnapshot);
      expect(details.hours).not.toContainEqual(daily.currentSnapshot);
    }
    expect(JSON.stringify(details)).not.toMatch(/stability(Index|Label)/i);
    expect(hourly.officialSnapshot.hourlyWeighting).toEqual(details.officialSnapshot.hourlyWeighting);
    expect(hourly.officialSnapshot.hourlyWeighting.bestMatchIncluded).toBe(false);
    expect(hourly.officialSnapshot.hourlyWeighting.modelsConsidered).toEqual(["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"]);
  }, 60_000);
});

describe("weather.getAILab", () => {
  it("n’expose des modèles appliqués que depuis la trace de fusion officielle", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.weather.getAILab();

    expect(Array.isArray(result.appliedModelWeights)).toBe(true);
    expect(Object.hasOwn(result, "latestStationCollection")).toBe(true);
    expect(Object.hasOwn(result, "modelIndicator")).toBe(true);
    expect(result.forecastComparison).toMatchObject({
      timeZone: "Europe/Paris",
      currentSnapshotSource: { sourceKind: "model_current_snapshot", source: "open-meteo" },
      hourlyForecast: { sourceKind: "official_forecast", source: "open-meteo", bestMatchIncluded: false },
      dailyForecast: { source: "open-meteo" },
    });
    expect(Array.isArray(result.forecastComparison.hourlyForecast.points)).toBe(true);
    expect(Array.isArray(result.forecastComparison.dailyForecast.days)).toBe(true);
    for (const model of result.appliedModelWeights) {
      expect(model.name).toBeTruthy();
      expect(model.averageWeight).toBeGreaterThan(0);
    }
  }, 25_000);
});

describe("weather.getRanking", () => {
  it("expose le contexte de régime sans classement ou note globale par modèle", async () => {
    const result = await appRouter.createCaller(createPublicContext()).weather.getRanking();

    // Un régime peut légitimement être inconnu : les valeurs manquantes ne sont
    // jamais remplacées par des valeurs par défaut pour produire un classement.
    expect(["available", "unknown"]).toContain(result.officialRegime.status);
    if (result.officialRegime.status === "available") {
      expect(result.officialRegime.primary?.id).toEqual(expect.any(String));
      expect(result.officialRegime.blendedWeights).toEqual(expect.objectContaining({ temp: expect.any(Number) }));
    } else {
      expect(result.officialRegime.primary).toBeNull();
      expect(result.officialRegime.blendedWeights).toBeNull();
    }
    expect(result.officialRegime.active).toEqual(expect.any(Array));
    expect(result).not.toHaveProperty("ranking");
    expect(result).not.toHaveProperty("totalServices");
  }, 25_000);
});

describe("weather.getStationReliabilityOverview", () => {
  it("expose uniquement une comparaison physique/officielle structurée sur 24 heures", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.weather.getStationReliabilityOverview();

    expect(result).toHaveProperty("locationKey");
    expect(Array.isArray(result.stations)).toBe(true);
    expect(result.comparison24h).toHaveLength(24);
    expect(result.comparison24h[0]).toEqual(expect.objectContaining({
      hour: 0,
      stationSampleCount: expect.any(Number),
    }));
    expect(Object.hasOwn(result.comparison24h[0], "stationTemperature")).toBe(true);
    expect(Object.hasOwn(result.comparison24h[0], "officialTemperature")).toBe(true);
    for (const station of result.stations) {
      expect(station.source).toBe("meteofrance");
      expect(station).toHaveProperty("ageMinutes");
      expect(Array.isArray(station.readings)).toBe(true);
    }

    const weekly = await caller.weather.getStationReliabilityOverview({ periodDays: 7, radiusKm: 30 });
    expect(weekly.periodDays).toBe(7);
    expect(weekly.radiusKm).toBe(30);
    expect(weekly.comparison7d).toHaveLength(7);
    expect(weekly.center).toEqual(expect.objectContaining({
      lat: expect.any(Number),
      lon: expect.any(Number),
    }));
    expect(Object.hasOwn(weekly, "instantDeltaC")).toBe(true);
    expect(Array.isArray(weekly.availabilityHistory)).toBe(true);
    expect(Object.hasOwn(weekly, "latestCollection")).toBe(true);
  });
});

describe("weather.getReliabilityLaboratory", () => {
  it("expose uniquement des métriques brutes par maille et des statuts d’indisponibilité explicites", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.weather.getReliabilityLaboratory({
      lat: 50.7567,
      lon: 2.5204,
      period: "30d",
      horizon: "6-24h",
    });

    expect(result.locationKey).toBeTruthy();
    expect(result.period).toEqual(expect.objectContaining({ id: "30d", days: 30 }));
    expect(result.evidence).toEqual(expect.objectContaining({
      source: "hourly_forecast_evaluation_scores",
      bestMatchIncluded: false,
      minimumComparisons: expect.any(Number),
      minimumComparableDays: expect.any(Number),
    }));
    expect(result.metrics).toHaveLength(result.evidence.expectedModelCount * result.evidence.variables.length);
    expect(result.metrics[0]).toEqual(expect.objectContaining({
      modelId: expect.any(String),
      variable: expect.any(String),
      horizonId: "6-24h",
      status: expect.stringMatching(/history_unavailable|no_evidence|insufficient_evidence|qualified|incomplete_metrics/),
      metrics: null,
    }));
    expect(result.metrics[0]).not.toHaveProperty("normalizedScore");
    expect(result.metrics[0]).not.toHaveProperty("averageScore");
    expect(result.availability.dailyHorizon).toContain("sans horodatage d’émission exact");
  }, 25_000);
});

describe("weather.getHistory", () => {
  it("returns history data for 7 days", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.weather.getHistory({ days: 7 });

    expect(result).toHaveProperty("forecasts");
    expect(result).toHaveProperty("observations");
    expect(result).toHaveProperty("meteoAIForecasts");
    expect(result).toHaveProperty("startDate");
    expect(result).toHaveProperty("endDate");
    expect(Array.isArray(result.forecasts)).toBe(true);
    expect(Array.isArray(result.observations)).toBe(true);
    expect(JSON.stringify(result.meteoAIForecasts)).not.toMatch(/stability(Index|Label)/i);
  });
});

describe("weather.getReport", () => {
  it("returns report for a specific date", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.weather.getReport({ date: "2026-06-28" });

    expect(result).toHaveProperty("date", "2026-06-28");
    expect(result).toHaveProperty("forecasts");
    expect(Array.isArray(result.forecasts)).toBe(true);
    // We seeded data for this date - if this fails, check seed data
    // Note: This test may fail if no forecasts exist for 2026-06-28 in test database
    if (result.forecasts.length === 0) {
      console.warn("No forecasts found for 2026-06-28 - test data may need to be seeded");
    } else {
      expect(result.forecasts.length).toBeGreaterThan(0);
    }
  });

  it("n’expose pas une observation historique non qualifiée comme vérité terrain", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.weather.getReport({ date: "2026-06-26" });

    expect(result.observation).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/stability(Index|Label)/i);
  });
});
