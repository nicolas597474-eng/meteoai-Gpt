import { describe, expect, it } from "vitest";
import { buildOfficialRegime, buildOperationalRegime, findNextHourlyRegimeChange } from "./officialRegime";

const now = Date.parse("2026-08-12T08:00:00.000Z");
const completeSnapshot = {
  tempMax: 24,
  tempMin: 14,
  precipitation: 0,
  windSpeed: 10,
  humidity: 55,
  cloudCover: 65,
  visibilityKm: 10,
  computedAt: new Date("2026-08-12T05:00:00.000Z"),
};

describe("buildOperationalRegime", () => {
  it("privilégie une observation plus récente, fraîche et complètement renseignée", () => {
    const regime = buildOperationalRegime(
      completeSnapshot,
      {
        tempMax: 20,
        tempMin: 12,
        precipitation: 0,
        windSpeed: 8,
        humidity: 55,
        cloudCover: 30,
        visibilityKm: 10,
        collectedAt: new Date("2026-08-12T07:30:00.000Z"),
      },
      undefined,
      now,
    );
    expect(regime.status).toBe("available");
    expect(regime.source).toBe("fresh_observation");
    expect(regime.primary?.id).toBe("few_clouds");
    expect(regime.sourceAgeMinutes).toBe(30);
    expect(Object.fromEntries(regime.inputDiagnostics.map(({ key, value }) => [key, value]))).toMatchObject({
      temperature: regime.params.temperature,
      precipitation: regime.params.precipitation,
      windSpeed: regime.params.windSpeed,
      humidity: regime.params.humidity,
      cloudCover: regime.params.cloudCover,
      visibilityKm: regime.params.visibilityKm,
    });
    expect(regime.inputDiagnostics.find((input) => input.key === "visibilityKm")).toMatchObject({
      value: 10,
      status: "available",
      source: "fresh_observation",
      sourceUpdatedAt: "2026-08-12T07:30:00.000Z",
      validAt: "2026-08-12T07:30:00.000Z",
      sourceAgeMinutes: 30,
    });
  });

  it("conserve le snapshot complet lorsqu’une observation est trop ancienne ou incomplète", () => {
    const regime = buildOperationalRegime(
      completeSnapshot,
      { tempMax: 20, precipitation: 0, windSpeed: 8, cloudCover: 30, collectedAt: new Date("2026-08-12T03:00:00.000Z") },
      undefined,
      now,
    );
    expect(regime.status).toBe("available");
    expect(regime.source).toBe("official_snapshot");
    expect(regime.primary?.id).toBe("partly_cloudy");
    expect(regime.inputDiagnostics.every((input) => input.source === "official_snapshot")).toBe(true);
    expect(regime.inputDiagnostics.find((input) => input.key === "temperature")?.value).toBe(regime.params.temperature);
  });

  it("privilégie une prévision horaire complète et conserve zéro comme valeur réelle", () => {
    const regime = buildOperationalRegime(
      null,
      null,
      { temp: 0, precipitation: 0, windSpeed: 0, humidity: 0, cloudCover: 0, visibilityKm: 10, updatedAt: new Date("2026-08-12T07:55:00.000Z"), sourceUpdatedAt: new Date("2026-08-12T07:55:00.000Z"), validAt: Date.parse("2026-08-12T08:00:00.000Z"), sourceLabel: "Prévision horaire officielle · 7 modèles" },
      now,
    );
    expect(regime.status).toBe("available");
    expect(regime.source).toBe("hourly_forecast");
    expect(regime.primary?.id).toBe("sunny");
    expect(regime.params).toMatchObject({ temperature: 0, precipitation: 0, windSpeed: 0, humidity: 0, cloudCover: 0 });
    expect(regime.inputDiagnostics.every((input) => input.source === "hourly_forecast" && input.sourceLabel === "Prévision horaire officielle · 7 modèles")).toBe(true);
    expect(regime.inputDiagnostics.find((input) => input.key === "temperature")).toMatchObject({ value: 0, status: "available", validAt: "2026-08-12T08:00:00.000Z" });
  });

  it("signale une série horaire périmée sans modifier le choix fondé sur updatedAt", () => {
    const actualSourceAt = new Date(now - 25 * 60_000);
    const regime = buildOperationalRegime(
      null,
      null,
      {
        temp: 18,
        precipitation: 0,
        windSpeed: 8,
        humidity: 45,
        cloudCover: 0,
        visibilityKm: 10,
        updatedAt: new Date(now - 60_000),
        sourceUpdatedAt: actualSourceAt,
        validAt: now,
      },
      now,
    );

    expect(regime.source).toBe("hourly_forecast");
    expect(regime.status).toBe("available");
    expect(regime.sourceUpdatedAt).toBe(actualSourceAt.toISOString());
    expect(regime.sourceAgeMinutes).toBe(25);
    expect(regime.inputDiagnostics.every((input) => input.status === "stale")).toBe(true);
  });

  it("renvoie unknown plutôt que de remplacer une entrée officielle manquante par 15/0/0", () => {
    const regime = buildOperationalRegime(
      { ...completeSnapshot, precipitation: null, windSpeed: null, visibilityKm: null },
      null,
      undefined,
      now,
    );
    expect(regime.status).toBe("unknown");
    expect(regime.primary).toBeNull();
    expect(regime.active).toEqual([]);
    expect(regime.confidence).toBeNull();
    expect(regime.blendedWeights).toBeNull();
    expect(regime.params).toMatchObject({ temperature: 19, precipitation: null, windSpeed: null, visibilityKm: null });
    expect(regime.description).toMatch(/indisponible/i);
    expect(regime.inputDiagnostics).toHaveLength(6);
    expect(regime.inputDiagnostics.find((input) => input.key === "visibilityKm")).toMatchObject({ value: null, status: "missing", source: "official_snapshot" });
  });

  it("ne classe pas un instant horaire partiel ou non fini et ne fabrique pas de changement futur", () => {
    const regime = buildOperationalRegime(
      null,
      null,
      { temp: 18, precipitation: 0, windSpeed: 8, humidity: 45, cloudCover: 0, visibilityKm: null, updatedAt: new Date("2026-08-12T07:55:00.000Z"), validAt: Date.parse("2026-08-12T08:00:00.000Z") },
      now,
    );
    expect(regime.status).toBe("unknown");
    expect(regime.primary).toBeNull();
    expect(regime.params).toMatchObject({ temperature: 18, precipitation: 0, windSpeed: 8, visibilityKm: null });
    expect(regime.source).toBe("hourly_forecast_partial");
    expect(regime.inputDiagnostics.find((input) => input.key === "visibilityKm")).toMatchObject({ value: null, status: "missing", source: "hourly_forecast_partial", validAt: "2026-08-12T08:00:00.000Z" });
    expect(regime.inputDiagnostics.find((input) => input.key === "windSpeed")).toMatchObject({ value: 8, status: "available" });

    const nextChange = findNextHourlyRegimeChange([
      { hour: "09:00", temp: 18, precipitation: 0, windSpeed: 8, humidity: 45, cloudCover: 0, visibilityKm: 10 },
      { hour: "10:00", temp: 19, precipitation: null, windSpeed: 8, humidity: 45, cloudCover: 95, visibilityKm: 10 },
    ], "09:00", "sunny");
    expect(nextChange).toBeNull();
  });

  it("garde la phase incertaine dans toutes les voies actives en présence de précipitations froides", () => {
    const coldSnapshot = { ...completeSnapshot, tempMax: 0, tempMin: -2, precipitation: 1 };
    expect(buildOfficialRegime(coldSnapshot).primary?.id).toBe("winter_precipitation_uncertain");

    const observation = buildOperationalRegime(
      completeSnapshot,
      { tempMax: 0, tempMin: -2, precipitation: 1, windSpeed: 8, humidity: 55, cloudCover: 65, visibilityKm: 10, collectedAt: new Date(now - 30 * 60_000) },
      undefined,
      now,
    );
    expect(observation.source).toBe("fresh_observation");
    expect(observation.primary?.id).toBe("winter_precipitation_uncertain");

    const hourly = buildOperationalRegime(
      null,
      null,
      { temp: -1, precipitation: 1, windSpeed: 8, humidity: 55, cloudCover: 65, visibilityKm: 10, updatedAt: new Date(now - 5 * 60_000) },
      now,
    );
    expect(hourly.source).toBe("hourly_forecast");
    expect(hourly.primary?.id).toBe("winter_precipitation_uncertain");

    const nextChange = findNextHourlyRegimeChange([
      { hour: "09:00", temp: 10, precipitation: 0, windSpeed: 8, humidity: 55, cloudCover: 0, visibilityKm: 10 },
      { hour: "10:00", temp: -1, precipitation: 1, windSpeed: 8, humidity: 55, cloudCover: 65, visibilityKm: 10 },
    ], "09:00", "sunny");
    expect(nextChange).toMatchObject({ id: "winter_precipitation_uncertain", label: "Précipitations hivernales — phase incertaine" });
  });

  it("retourne le premier changement de régime dans les créneaux futurs complets", () => {
    const change = findNextHourlyRegimeChange([
      { hour: "09:00", temp: 18, precipitation: 0, windSpeed: 8, humidity: 45, cloudCover: 0, visibilityKm: 10 },
      { hour: "10:00", temp: 19, precipitation: 0, windSpeed: 8, humidity: 45, cloudCover: 0, visibilityKm: 10 },
      { hour: "11:00", temp: 19, precipitation: 0, windSpeed: 10, humidity: 55, cloudCover: 60, visibilityKm: 10 },
    ], "09:00", "sunny");
    expect(change).toMatchObject({ hour: "11:00", id: "partly_cloudy", cloudCover: 60 });
  });

  it("normalise les heures sans zéro initial pour détecter le prochain changement", () => {
    const change = findNextHourlyRegimeChange([
      { hour: "6:00", temp: 15, precipitation: 0, windSpeed: 5, humidity: 50, cloudCover: 4, visibilityKm: 10 },
      { hour: "07:00", temp: 16, precipitation: 0, windSpeed: 5, humidity: 50, cloudCover: 8, visibilityKm: 10 },
      { hour: "08:00", temp: 17, precipitation: 0, windSpeed: 6, humidity: 55, cloudCover: 65, visibilityKm: 10 },
    ], "06:00", "sunny");
    expect(change).toMatchObject({ hour: "08:00", id: "partly_cloudy", cloudCover: 65 });
  });

  it("utilise validAt pour la seconde heure locale répétée au changement d’heure", () => {
    const hours = [
      { hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00.000Z"), temp: 18, precipitation: 0, windSpeed: 8, humidity: 45, cloudCover: 0, visibilityKm: 10 },
      { hour: "02:00", validAt: Date.parse("2026-10-25T01:00:00.000Z"), temp: 18, precipitation: 0, windSpeed: 8, humidity: 55, cloudCover: 60, visibilityKm: 10 },
      { hour: "03:00", validAt: Date.parse("2026-10-25T02:00:00.000Z"), temp: 18, precipitation: 0, windSpeed: 8, humidity: 55, cloudCover: 60, visibilityKm: 10 },
      { hour: "04:00", validAt: Date.parse("2026-10-25T03:00:00.000Z"), temp: 18, precipitation: 0, windSpeed: 8, humidity: 45, cloudCover: 0, visibilityKm: 10 },
    ];
    const change = findNextHourlyRegimeChange(hours, "02:00", "partly_cloudy", hours[1].validAt);
    expect(change).toMatchObject({ hour: "04:00", id: "sunny" });
  });

  it("ne fabrique ni source ni valeurs quand le snapshot est absent", () => {
    const regime = buildOfficialRegime(null, now);
    expect(regime.status).toBe("unknown");
    expect(regime.inputDiagnostics).toHaveLength(6);
    expect(regime.inputDiagnostics.every((input) => input.value === null && input.status === "missing" && input.source === null && input.sourceLabel === "Aucun snapshot quotidien disponible")).toBe(true);
  });

  it("distingue une entrée non finie d’une entrée absente dans le snapshot utilisé", () => {
    const regime = buildOfficialRegime({ ...completeSnapshot, humidity: Number.NaN }, now);
    expect(regime.status).toBe("unknown");
    expect(regime.inputDiagnostics.find((input) => input.key === "humidity")).toMatchObject({ value: null, status: "invalid", source: "official_snapshot" });
    expect(regime.inputDiagnostics.find((input) => input.key === "visibilityKm")).toMatchObject({ value: 10, status: "available" });
  });
});
