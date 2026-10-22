import { describe, expect, it } from "vitest";
import { withDeadline, buildDatedDailyFusionFallback, buildOfficialWeatherSnapshot, getOfficialSnapshotTtlMs, getOfficialWeatherSnapshotCacheKey, isHourlyCoverageNonDecreasing, mergeManualHourlyForecast, refreshOfficialWeatherSnapshotForecastWindow } from "./officialWeatherSnapshot";
import { makeLocationKey } from "./db";

const unavailableWeighting = {
  status: "unavailable" as const,
  historyStatus: "available" as const,
  historyWindowDays: 365,
  minimumComparisons: 30,
  minimumComparableDays: 7,
  bestMatchIncluded: false as const,
  modelsConsidered: ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"] as const,
  modelsWithData: [],
  horizons: [],
};

const modelCurrentSnapshot = {
  sourceKind: "model_current_snapshot" as const,
  source: "open-meteo" as const,
  capturedAt: "2026-08-12T12:00:00.000Z",
  temp: 25,
  apparentTemp: 24,
  precipitation: 0,
  windSpeed: 7,
  windGust: 10,
  windDirection: 180,
  cloudCover: 20,
  humidity: 55,
  weatherCode: 1,
  condition: "Ensoleillé",
};

describe("buildOfficialWeatherSnapshot", () => {
  it("normalise les coordonnées de cache à la précision métier sans changer la clé DB canonique", () => {
    const first = { lat: 50.75631, lon: 2.52031 };
    const second = { lat: 50.75649, lon: 2.52049 };

    expect(makeLocationKey(first.lat, first.lon)).toBe(makeLocationKey(second.lat, second.lon));
    expect(getOfficialWeatherSnapshotCacheKey(first, "2026-08-12", 492)).toBe(
      getOfficialWeatherSnapshotCacheKey(second, "2026-08-12", 492),
    );
    expect(getOfficialWeatherSnapshotCacheKey(first, "2026-08-12", 492, 2)).not.toBe(
      getOfficialWeatherSnapshotCacheKey(first, "2026-08-12", 492, 16),
    );
    expect(getOfficialWeatherSnapshotCacheKey(first, "2026-08-12", 492, 2)).toBe(
      getOfficialWeatherSnapshotCacheKey(first, "2026-08-12", 493, 2),
    );
  });

  it("conserve séparément le snapshot du modèle et la prévision horaire active", () => {
    const snapshot = buildOfficialWeatherSnapshot({
      lat: 50.75646,
      lon: 2.52085,
      weatherDate: "2026-08-12",
      computedAt: new Date("2026-08-12T12:01:00.000Z"),
      hourlyWeighting: unavailableWeighting,
      parisHour: "14",
      hourly: [
        { date: "2026-08-12", hour: "13:00", validAt: Date.parse("2026-08-12T11:00:00.000Z"), temp: 21.1, apparentTemp: 21.1, precipitation: 0, windSpeed: 8, windGust: 12, windDirection: 180, cloudCover: 10, humidity: 55, uvIndex: 5, condition: "Ensoleillé" },
        { date: "2026-08-12", hour: "14:00", validAt: Date.parse("2026-08-12T12:00:00.000Z"), temp: 23.4, apparentTemp: 23.2, precipitation: 0, windSpeed: 9, windGust: 14, windDirection: 180, cloudCover: 12, humidity: 50, uvIndex: 6, condition: "Ensoleillé" },
        { date: "2026-08-12", hour: "15:00", validAt: Date.parse("2026-08-12T13:00:00.000Z"), temp: 24, apparentTemp: 24, precipitation: 0, windSpeed: 8, windGust: 12, windDirection: 10, cloudCover: 10, humidity: 48, uvIndex: 6, condition: "Ensoleillé" },
      ],
      currentSnapshot: modelCurrentSnapshot,
      daily: [],
      modelsUsed: ["ECMWF"],
    });

    expect(snapshot.currentSnapshot?.temp).toBe(25);
    expect(snapshot.currentSnapshot?.sourceKind).toBe("model_current_snapshot");
    expect(snapshot.hourly.map(({ hour, temp }) => [hour, temp])).toEqual([["14:00", 23.4], ["15:00", 24]]);
    expect(snapshot.validAt).toBe("2026-08-12T14:00");
    expect(snapshot.sourceKind).toBe("official_forecast");
    expect(snapshot.source).toBe("open-meteo");
    expect(snapshot).toMatchObject({ snapshotStatus: "live", staleReason: null });
    expect(snapshot.hourlyWeighting.bestMatchIncluded).toBe(false);
  });

  it("raccourcit le cache uniquement lorsque la source horaire ne renvoie aucune donnée", () => {
    expect(getOfficialSnapshotTtlMs([])).toBe(12_000);
    expect(getOfficialSnapshotTtlMs([
      { hour: "14:00", temp: 23.4, apparentTemp: 23.2, precipitation: 0, windSpeed: 9, windGust: 14, windDirection: 180, cloudCover: 12, humidity: 50, uvIndex: 6, condition: "Ensoleillé" },
    ])).toBe(120_000);
  });

  it("sélectionne l’instant courant exact lorsque l’heure locale se répète au changement d’heure", () => {
    const snapshot = buildOfficialWeatherSnapshot({
      lat: 50.75646,
      lon: 2.52085,
      weatherDate: "2026-10-25",
      computedAt: new Date("2026-10-25T01:30:00.000Z"),
      hourlyWeighting: unavailableWeighting,
      parisHour: "02",
      hourly: [
        { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00.000Z"), temp: 10, apparentTemp: 10, precipitation: 0, windSpeed: 5, windGust: 8, windDirection: 180, cloudCover: 50, humidity: 80, uvIndex: 0, condition: "Nuageux" },
        { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T01:00:00.000Z"), temp: 11, apparentTemp: 11, precipitation: 0, windSpeed: 5, windGust: 8, windDirection: 180, cloudCover: 50, humidity: 80, uvIndex: 0, condition: "Nuageux" },
      ],
      currentSnapshot: modelCurrentSnapshot,
      daily: [],
      modelsUsed: [],
    });

    expect(snapshot.currentSnapshot?.temp).toBe(25);
    expect(snapshot.hourly).toMatchObject([{ validAt: Date.parse("2026-10-25T01:00:00.000Z"), temp: 11 }]);
    expect(snapshot.hourly).toHaveLength(1);
  });

  it("actualise les heures prévisionnelles sans modifier le point courant officiel", () => {
    const snapshot = buildOfficialWeatherSnapshot({
      lat: 50.75646,
      lon: 2.52085,
      weatherDate: "2026-08-12",
      computedAt: new Date("2026-08-12T12:01:00.000Z"),
      hourlyWeighting: unavailableWeighting,
      parisHour: "14",
      hourly: [
        { date: "2026-08-12", hour: "14:00", validAt: Date.parse("2026-08-12T12:00:00.000Z"), temp: 23.4, apparentTemp: 23.2, precipitation: 0, windSpeed: 9, windGust: 14, windDirection: 180, cloudCover: 12, humidity: 50, uvIndex: 6, condition: "Ensoleillé" },
        { date: "2026-08-12", hour: "15:00", validAt: Date.parse("2026-08-12T13:00:00.000Z"), temp: 24, apparentTemp: 24, precipitation: 0, windSpeed: 8, windGust: 12, windDirection: 180, cloudCover: 10, humidity: 48, uvIndex: 6, condition: "Ensoleillé" },
      ],
      currentSnapshot: modelCurrentSnapshot,
      daily: [],
      modelsUsed: ["Open-Meteo Best Match"],
    });
    const refreshedAt = new Date("2026-08-12T12:10:00.000Z");
    const refreshed = mergeManualHourlyForecast(snapshot, [
      { date: "2026-08-12", hour: "14:00", validAt: Date.parse("2026-08-12T12:00:00.000Z"), temp: 99, apparentTemp: 99, precipitation: 1, windSpeed: 99, windGust: 99, windDirection: 0, cloudCover: 99, humidity: 99, uvIndex: 0, condition: "Pluie" },
      { date: "2026-08-12", hour: "15:00", validAt: Date.parse("2026-08-12T13:00:00.000Z"), temp: 25.2, apparentTemp: 25.2, precipitation: 0.1, windSpeed: 11, windGust: 14, windDirection: 190, cloudCover: 20, humidity: 45, uvIndex: 5, condition: "Nuageux" },
    ], refreshedAt, undefined, "Rafraîchissement manuel demandé explicitement.");

    expect(refreshed.currentSnapshot).toEqual(snapshot.currentSnapshot);
    expect(refreshed.computedAt).toBe(snapshot.computedAt);
    expect(refreshed.hourlyComputedAt).toBe(refreshedAt.toISOString());
    expect(refreshed.officialHourlyOriginal).toEqual(snapshot.hourly);
    expect(refreshed.hourlyOverride).toMatchObject({
      source: "manual_refresh",
      reason: "Rafraîchissement manuel demandé explicitement.",
      officialOriginalComputedAt: snapshot.hourlyComputedAt,
      officialOriginalPreserved: true,
      officialOriginalPointCount: snapshot.hourly.length,
    });
    expect(refreshed.hourlyWeighting.manualOverride).toEqual(refreshed.hourlyOverride);
    expect(refreshed.hourly.find((hour) => hour.validAt === Date.parse("2026-08-12T12:00:00.000Z"))?.temp).toBe(99);
    expect(refreshed.hourly.find((hour) => hour.validAt === Date.parse("2026-08-12T13:00:00.000Z"))?.temp).toBe(25.2);
  });

  it("retire à la relecture du cache l’échéance qui vient de se terminer", () => {
    const snapshot = buildOfficialWeatherSnapshot({
      lat: 50.75646,
      lon: 2.52085,
      weatherDate: "2026-08-12",
      computedAt: new Date("2026-08-12T12:45:00.000Z"),
      hourlyWeighting: unavailableWeighting,
      parisHour: "14",
      hourly: [
        { date: "2026-08-12", hour: "14:00", validAt: Date.parse("2026-08-12T12:00:00.000Z"), temp: 23.4, apparentTemp: 23.2, precipitation: 0, windSpeed: 9, windGust: 14, windDirection: 180, cloudCover: 12, humidity: 50, uvIndex: 6, condition: "Ensoleillé" },
        { date: "2026-08-12", hour: "15:00", validAt: Date.parse("2026-08-12T13:00:00.000Z"), temp: 24, apparentTemp: 24, precipitation: 0, windSpeed: 8, windGust: 12, windDirection: 10, cloudCover: 10, humidity: 48, uvIndex: 6, condition: "Ensoleillé" },
      ],
      currentSnapshot: modelCurrentSnapshot,
      daily: [],
      modelsUsed: ["ECMWF"],
    });

    const refreshed = refreshOfficialWeatherSnapshotForecastWindow(snapshot, Date.parse("2026-08-12T13:05:00.000Z"));

    expect(refreshed.hourly).toMatchObject([{ validAt: Date.parse("2026-08-12T13:00:00.000Z"), temp: 24 }]);
    expect(refreshed.validAt).toBe("2026-08-12T15:00");
    expect(refreshed.currentSnapshot).toEqual(modelCurrentSnapshot);
  });

  it("refuse une relance horaire vide ou moins couverte sans masquer une série officielle valide", () => {
    const snapshot = buildOfficialWeatherSnapshot({
      lat: 50.75646,
      lon: 2.52085,
      weatherDate: "2026-08-12",
      computedAt: new Date("2026-08-12T12:01:00.000Z"),
      hourlyWeighting: unavailableWeighting,
      parisHour: "14",
      hourly: [
        { date: "2026-08-12", hour: "14:00", validAt: Date.parse("2026-08-12T12:00:00.000Z"), temp: 0, apparentTemp: 0, precipitation: 0, windSpeed: 0, windGust: 0, windDirection: 0, cloudCover: 0, humidity: 0, uvIndex: 0, condition: "Ensoleillé" },
        { date: "2026-08-12", hour: "15:00", validAt: Date.parse("2026-08-12T13:00:00.000Z"), temp: 12, apparentTemp: 12, precipitation: 0, windSpeed: 4, windGust: 5, windDirection: 10, cloudCover: 10, humidity: 55, uvIndex: 2, condition: "Ensoleillé" },
      ],
      currentSnapshot: modelCurrentSnapshot,
      daily: [],
      modelsUsed: ["ECMWF"],
    });
    const partial = snapshot.hourly.map((point, index) => index === 0 ? { ...point, temp: null } : point);
    const emptyRefresh = mergeManualHourlyForecast(snapshot, [], new Date("2026-08-12T12:10:00.000Z"));
    const partialRefresh = mergeManualHourlyForecast(snapshot, partial, new Date("2026-08-12T12:10:00.000Z"));

    expect(isHourlyCoverageNonDecreasing(snapshot.hourly, [])).toBe(false);
    expect(isHourlyCoverageNonDecreasing(snapshot.hourly, partial)).toBe(false);
    expect(emptyRefresh).toBe(snapshot);
    expect(partialRefresh).toBe(snapshot);
    expect(snapshot.hourly[0].temp).toBe(0);

    const completeRefresh = mergeManualHourlyForecast(
      snapshot,
      snapshot.hourly.map((point) => ({ ...point, temp: 0 })),
      new Date("2026-08-12T12:10:00.000Z"),
    );
    expect(completeRefresh.hourly).toHaveLength(2);
    expect(completeRefresh.hourly[0].temp).toBe(0);
    expect(completeRefresh.hourlyOverride?.source).toBe("manual_refresh");
  });

  it("conserve la date et l’horodatage d’une fusion quotidienne sans la présenter comme horaire", () => {
    const fallback = buildDatedDailyFusionFallback({
      date: "2026-08-11",
      computedAt: new Date("2026-08-11T03:05:00.000Z"),
      tempMax: 24.1,
      tempMin: 13.2,
      precipitation: 1.4,
      windSpeed: 18,
      condition: "Nuageux",
    });

    expect(fallback).toEqual({
      kind: "daily_fusion",
      date: "2026-08-11",
      computedAt: "2026-08-11T03:05:00.000Z",
      tempMax: 24.1,
      tempMin: 13.2,
      precipitation: 1.4,
      precipitationConsensus: null,
      windSpeed: 18,
      condition: "Nuageux",
    });
  });
});

describe("withDeadline (chemin archive, état actuel borné)", () => {
  it("renvoie la valeur si elle arrive avant l'échéance", async () => {
    await expect(withDeadline(Promise.resolve("live"), 50, "fallback")).resolves.toBe("live");
  });

  it("renvoie le repli si la valeur n'arrive pas avant l'échéance", async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 200));
    const started = Date.now();
    await expect(withDeadline(slow, 20, "fallback")).resolves.toBe("fallback");
    expect(Date.now() - started).toBeLessThan(150);
  });

  it("renvoie le repli si la source rejette", async () => {
    await expect(withDeadline(Promise.reject(new Error("timeout")), 50, null)).resolves.toBeNull();
  });
});
