import { describe, expect, it } from "vitest";
import {
  formatCurrentStateProvenance,
  formatDashboardNumber,
  getRegimeProvenancePresentation,
  withCurrentSnapshotFallback,
} from "./dashboardPresentation";

describe("présentation des champs météo du Dashboard", () => {
  it("arrondit en français uniquement pour l’affichage et garde les valeurs absentes lisibles", () => {
    expect(formatDashboardNumber(3.042695924868569)).toBe("3");
    expect(formatDashboardNumber(75.57272978586494)).toBe("75,6");
    expect(formatDashboardNumber(null)).toBe("—");
  });

  it("présente le nombre de stations et l’âge le plus ancien de la provenance du champ reçu", () => {
    const windSpeed = {
      value: 3.04,
      provenance: {
        kind: "physical_stations" as const,
        label: "Stations physiques qualifiées",
        stationCount: 30,
        stationSources: ["Netatmo"],
        observedAt: null,
        ageMinutes: 9,
        reason: null,
        measurements: [],
      },
    };
    const windDirection = {
      ...windSpeed,
      value: 45,
      provenance: { ...windSpeed.provenance, stationCount: 2, ageMinutes: 4 },
    };

    expect(formatCurrentStateProvenance(windSpeed)).toBe(
      "30 stations · Netatmo · plus ancien : il y a 9 min"
    );
    expect(formatCurrentStateProvenance(windDirection)).toBe(
      "2 stations · Netatmo · plus ancien : il y a 4 min"
    );
  });

  it("complète un champ manquant depuis le snapshot courant Open-Meteo et conserve sa provenance", () => {
    const nowMs = Date.parse("2026-10-08T02:00:00.000Z");
    const capturedAt = "2026-10-08T01:55:00.000Z";
    const field = withCurrentSnapshotFallback(
      {
        value: null,
        provenance: {
          kind: "unavailable",
          label: "Indisponible",
          stationCount: 0,
          stationSources: [],
          observedAt: null,
          ageMinutes: null,
          reason: "Champ absent",
          measurements: [],
        },
      },
      "Pluie faible",
      capturedAt,
      nowMs
    );

    expect(field).toMatchObject({
      value: "Pluie faible",
      provenance: {
        kind: "open_meteo_snapshot",
        label: "Snapshot modèle Open-Meteo",
        stationSources: ["Open-Meteo"],
        observedAt: capturedAt,
        ageMinutes: 5,
      },
    });
    expect(formatCurrentStateProvenance(field, null, nowMs)).toBe(
      "Open-Meteo · 03:55 · il y a 5 min"
    );
  });

  it("garde une observation physique prioritaire et ne fabrique pas une valeur si le snapshot est absent", () => {
    const physicalField = {
      value: 89,
      provenance: {
        kind: "physical_stations" as const,
        label: "Stations physiques qualifiées",
        stationCount: 3,
        stationSources: ["Netatmo"],
        observedAt: null,
        ageMinutes: 8,
        reason: null,
        measurements: [],
      },
    };

    expect(
      withCurrentSnapshotFallback(physicalField, 55, "2026-10-08T01:55:00.000Z")
    ).toBe(physicalField);
    expect(withCurrentSnapshotFallback(null, null, null)).toBeNull();
  });

  it("présente une valeur prévue avec sa nature, sa source, son échéance et son heure de calcul", () => {
    const forecastField = {
      value: 33,
      provenance: {
        kind: "official_hourly_forecast" as const,
        label: "Prévision horaire officielle",
        stationCount: 0,
        stationSources: ["Open-Meteo"],
        observedAt: "2026-10-09T16:00:00.000Z",
        computedAt: "2026-10-09T16:06:00.000Z",
        ageMinutes: null,
        reason: null,
        measurements: [],
      },
    };

    expect(formatCurrentStateProvenance(forecastField)).toBe(
      "Prévu · Open-Meteo · 18:00 · calcul 18:06"
    );
    expect(
      formatCurrentStateProvenance({
        ...forecastField,
        provenance: { ...forecastField.provenance, computedAt: null },
      })
    ).toBe("Prévu · Open-Meteo · 18:00");
  });

  it("attribue au régime le libellé et l’horodatage de sa source réellement retenue", () => {
    const nowMs = Date.parse("2026-10-04T18:00:00.000Z");
    expect(
      getRegimeProvenancePresentation({
        source: "hourly_forecast",
        sourceLabel: "Prévision horaire actualisée",
        sourceUpdatedAt: "2026-10-04T17:30:00.000Z",
        hasRegime: true,
        nowMs,
      })
    ).toEqual({
      sourceLabel: "Prévision horaire actualisée",
      sourceTimeLabel: "19:30",
      freshnessLabel: "mis à jour il y a 30 min",
    });
  });

  it("ne remplace pas une source de régime indisponible par une origine horaire supposée", () => {
    expect(
      getRegimeProvenancePresentation({
        source: "official_snapshot",
        sourceLabel: "Régime indisponible",
        sourceUpdatedAt: null,
        hasRegime: false,
        nowMs: Date.parse("2026-10-04T18:00:00.000Z"),
      })
    ).toEqual({
      sourceLabel: "Snapshot officiel · régime indisponible",
      sourceTimeLabel: null,
      freshnessLabel: "Horodatage de source indisponible",
    });
  });
});
