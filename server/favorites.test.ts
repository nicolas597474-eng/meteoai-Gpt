import { describe, expect, it } from "vitest";
import { buildDashboardCurrentTemperature, getDashboardNetatmoCollectionOptions, getModeAlignedFusionConstraints, resolveLocalModeTemperature } from "./routers/favorites";

describe("buildDashboardCurrentTemperature", () => {
  it("utilise l’observation locale validée en modes Local et Ultra-local", () => {
    expect(buildDashboardCurrentTemperature({
      localMode: "ultra-local",
      temperature: 17,
      stationCount: 12,
      confidenceScore: 85,
      observedAt: "2026-08-12T06:30:00.000Z",
      officialTemperature: 14.4,
    })).toEqual({
      temperature: 17,
      stationCount: 12,
      confidenceScore: 85,
      source: "local_validated",
      observedAt: "2026-08-12T06:30:00.000Z",
      deltaFromOfficialC: 2.6,
    });
  });

  it("conserve l’écart signé entre une observation locale et la prévision officielle", () => {
    expect(buildDashboardCurrentTemperature({
      localMode: "ultra-local",
      temperature: 26.1,
      stationCount: 9,
      confidenceScore: 81,
      observedAt: "2026-08-16T09:15:00.000Z",
      officialTemperature: 21.8,
    })).toMatchObject({
      source: "local_validated",
      temperature: 26.1,
      deltaFromOfficialC: 4.3,
    });
  });

  it("conserve la prévision officielle en mode Standard ou sans source locale", () => {
    expect(buildDashboardCurrentTemperature({
      localMode: "standard",
      temperature: 17,
      stationCount: 12,
      confidenceScore: 85,
      observedAt: null,
      officialTemperature: 14.4,
    })).toBeNull();
    expect(buildDashboardCurrentTemperature({
      localMode: "local",
      temperature: null,
      stationCount: 0,
      confidenceScore: 0,
      observedAt: null,
      officialTemperature: 14.4,
    })).toBeNull();
  });

  it("aligne exactement les modes Local et Ultra-local sur l’officiel sans station physique", () => {
    expect(resolveLocalModeTemperature({
      officialTemperature: 30.7,
      localTemperature: 17.1,
      physicalStationCount: 0,
      microclimateAdjustment: -0.1,
      modelFallbackTemperature: null,
    })).toEqual({
      temperature: 30.7,
      usesOfficialFallback: true,
      microclimateAdjustment: 0,
      usesModelFallback: false,
    });
  });

  it("préserve la température locale et le micro-ajustement seulement avec une station qualifiée", () => {
    expect(resolveLocalModeTemperature({
      officialTemperature: 30.7,
      localTemperature: 29.9,
      physicalStationCount: 1,
      microclimateAdjustment: -0.2,
      modelFallbackTemperature: 30.7,
    })).toEqual({
      temperature: 29.9,
      usesOfficialFallback: false,
      microclimateAdjustment: -0.2,
      usesModelFallback: false,
    });
  });

  it("utilise la fusion officielle traçable si aucune station physique n’est valide", () => {
    expect(resolveLocalModeTemperature({
      officialTemperature: 31.1,
      localTemperature: null,
      physicalStationCount: 0,
      microclimateAdjustment: -0.1,
      modelFallbackTemperature: 30.4,
    })).toEqual({
      temperature: 30.4,
      usesOfficialFallback: false,
      microclimateAdjustment: 0,
      usesModelFallback: true,
    });
  });
});

describe("getDashboardNetatmoCollectionOptions", () => {
  it("transmet uniquement l’identité résolue côté serveur pour la session autorisée", () => {
    expect(getDashboardNetatmoCollectionOptions({ id: 42 })).toEqual({ netatmoUserId: 42 });
  });

  it("n’envoie aucune identité Netatmo lorsque la session est absente", () => {
    expect(getDashboardNetatmoCollectionOptions(null)).toEqual({});
    expect(getDashboardNetatmoCollectionOptions(undefined)).toEqual({});
  });

  it("peut exposer un statut Netatmo serveur sans faire remonter de jeton", () => {
    const statuses: string[] = [];
    const options = getDashboardNetatmoCollectionOptions({ id: 42 }, (status) => statuses.push(status));
    options.onNetatmoStatus?.("fresh_cache");
    expect(statuses).toEqual(["fresh_cache"]);
    expect(options).not.toHaveProperty("accessToken");
    expect(options).not.toHaveProperty("refreshToken");
  });
});

describe("getModeAlignedFusionConstraints", () => {
  it("ne réadmet pas dans la fusion une station trop ancienne pour le mode affiché", () => {
    expect(getModeAlignedFusionConstraints("local")).toMatchObject({ maxFreshnessMin: 60, maxTempDeviationC: 6, minReliabilityScore: 40 });
    expect(getModeAlignedFusionConstraints("ultra-local")).toMatchObject({ maxFreshnessMin: 30, maxTempDeviationC: 5, minReliabilityScore: 45 });
  });

  it("conserve le périmètre plus large réservé au mode Standard", () => {
    expect(getModeAlignedFusionConstraints("standard")).toMatchObject({ maxFreshnessMin: 180, maxTempDeviationC: 6, minReliabilityScore: 40 });
  });
});
