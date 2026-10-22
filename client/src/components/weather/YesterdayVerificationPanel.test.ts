import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { YesterdayVerificationPanel } from "./YesterdayVerificationPanel";

const unavailableData = {
  status: "unavailable" as const,
  reason: "Aucun snapshot physique qualifié n’est archivé pour cette date.",
  locationKey: "50.757_2.520",
  validDate: "2026-10-02",
  validFromAt: null,
  validToAt: null,
  timezone: "Europe/Paris" as const,
  forecastRunCount: 0,
  qualifiedSnapshotHours: 0,
  pairs: [],
  groups: [],
  meteoai: { status: "unavailable" as const, reason: "Aucune fusion immuable archivée.", pairCount: null, groups: [] },
  issues: [{ code: "no_qualified_physical_observation", count: 1, variable: "temperature_min" }],
};

const availableData = {
  ...unavailableData,
  status: "available" as const,
  reason: null,
  validFromAt: Date.parse("2026-10-01T22:00:00.000Z"),
  validToAt: Date.parse("2026-10-02T22:00:00.000Z"),
  forecastRunCount: 1,
  qualifiedSnapshotHours: 24,
  pairs: [{
    serviceName: "MeteoAI",
    modelId: "meteoai-official-daily-v2",
    variable: "temperature_max",
    horizonBucket: "6-24h",
    leadTimeMinutes: 900,
    forecastValue: 18.5,
    observedValue: 20,
    signedError: -1.5,
    validDate: "2026-10-02",
    forecastIssuedAt: Date.parse("2026-10-01T08:00:00.000Z"),
    forecastAvailableAt: Date.parse("2026-10-01T08:01:00.000Z"),
    observationWindowStartAt: Date.parse("2026-10-02T07:50:00.000Z"),
    observationWindowEndAt: Date.parse("2026-10-02T08:00:00.000Z"),
    stationEvidence: [{
      stationId: "mf-59000",
      stationName: "Météo-France · Calais",
      source: "meteofrance",
      snapshotHour: 10,
      observedAt: Date.parse("2026-10-02T07:50:00.000Z"),
      value: 20,
      weight: 1,
    }],
  }],
  groups: [{
    serviceName: "MeteoAI",
    modelId: "meteoai-official-daily-v2",
    variable: "temperature_max",
    horizonBucket: "6-24h",
    unit: "°C",
    mae: 1.5,
    rmse: 1.5,
    bias: -1.5,
    pairCount: 1,
    evaluatedDays: 1,
    validDates: ["2026-10-02"],
  }],
  meteoai: {
    status: "available" as const,
    reason: null,
    pairCount: 1,
    groups: [{
      serviceName: "MeteoAI",
      modelId: "meteoai-official-daily-v2",
      variable: "temperature_max",
      horizonBucket: "6-24h",
      unit: "°C",
      mae: 1.5,
      rmse: 1.5,
      bias: -1.5,
      pairCount: 1,
      evaluatedDays: 1,
      validDates: ["2026-10-02"],
    }],
  },
};

describe("YesterdayVerificationPanel — rendu mobile-first", () => {
  it("affiche clairement l’indisponibilité sans convertir les absences en zéro ou en verdict binaire", () => {
    const html = renderToStaticMarkup(createElement(YesterdayVerificationPanel, { data: unavailableData, locationName: "Hondeghem" }));
    expect(html).toContain("Indisponible");
    expect(html).toContain("Aucun snapshot physique qualifié n’est archivé pour cette date.");
    expect(html).toContain("Aucune fusion immuable archivée.");
    expect(html).not.toContain("n = 0");
    expect(html).not.toContain("0.00");
    expect(html).not.toContain("vrai");
    expect(html).not.toContain("faux");
  });

  it("rend l’émission, la disponibilité, la validité, l’erreur et la station de la paire sous-jacente", () => {
    const html = renderToStaticMarkup(createElement(YesterdayVerificationPanel, { data: availableData, locationName: "Hondeghem" }));
    expect(html).toContain("Émis :");
    expect(html).toContain("disponible :");
    expect(html).toContain("Valide : 2026-10-02");
    expect(html).toContain("erreur");
    expect(html).toContain("Météo-France · Calais");
    expect(html).toContain("MAE 1.50 °C");
    expect(html).toContain("aucun score de station calculé");
  });

  it("explique la variable absente dans un résultat partiel sans afficher une valeur de remplacement", () => {
    const partialData = {
      ...availableData,
      issues: [{ code: "forecast_value_missing", count: 1, variable: "temperature_min" }],
    };
    const html = renderToStaticMarkup(createElement(YesterdayVerificationPanel, { data: partialData, locationName: "Hondeghem" }));
    expect(html).toContain("Température minimale — Valeur prévue absente pour une variable.");
    expect(html).not.toContain("Température minimale · 0");
  });

  it("garde une seule colonne sur petit écran, puis augmente la grille aux breakpoints", () => {
    const html = renderToStaticMarkup(createElement(YesterdayVerificationPanel, { data: availableData, locationName: "Hondeghem" }));
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("xl:grid-cols-3");
    expect(html).toContain("min-w-0");
  });
});
