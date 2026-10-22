import { describe, expect, it } from "vitest";
import {
  buildLocalOfficialDeltaHistory,
  selectOfficialHourlyTemperaturesBeforeLocalMeasurements,
  selectedOfficialHourlyTemperaturePoints,
} from "./localOfficialHistory";

describe("buildLocalOfficialDeltaHistory", () => {
  it("compare les observations physiques à la température déjà calculée par le moteur horaire officiel", () => {
    const points = buildLocalOfficialDeltaHistory([
      { stationId: "mf-59000", observedAt: Date.parse("2026-08-12T06:31:00.000Z"), temperature: 17, distanceKm: 4, reliabilityScore: 92 },
      { stationId: "mf-123", observedAt: Date.parse("2026-08-12T06:45:00.000Z"), temperature: 16, distanceKm: 8, reliabilityScore: 92 },
    ], [
      { validAt: Date.parse("2026-08-12T06:00:00.000Z"), temperature: 14.4 },
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ validAt: Date.parse("2026-08-12T06:00:00.000Z"), officialTemperature: 14.4, stationCount: 2 });
    expect(points[0]?.label).toContain("08h");
    expect(points[0]?.localTemperature).toBeGreaterThan(16);
    expect(points[0]?.deltaC).toBeGreaterThan(1);
  });

  it("n’invente pas de comparaison lorsqu’aucune température officielle qualifiée n’est fournie", () => {
    expect(buildLocalOfficialDeltaHistory([
      { stationId: "mf-123", observedAt: Date.parse("2026-08-12T06:31:00.000Z"), temperature: null, distanceKm: 1, reliabilityScore: 92 },
    ], [])).toEqual([]);
  });

  it("garde séparées les deux heures locales répétées au retour à l’heure d’hiver", () => {
    const points = buildLocalOfficialDeltaHistory([
      { stationId: "station-summer", observedAt: Date.parse("2026-10-25T00:31:00.000Z"), temperature: 12, distanceKm: 2, reliabilityScore: 90 },
      { stationId: "station-winter", observedAt: Date.parse("2026-10-25T01:31:00.000Z"), temperature: 11, distanceKm: 2, reliabilityScore: 90 },
    ], [
      { validAt: Date.parse("2026-10-25T00:00:00.000Z"), temperature: 13 },
      { validAt: Date.parse("2026-10-25T01:00:00.000Z"), temperature: 10 },
    ]);

    expect(points).toHaveLength(2);
    expect(points.map((point) => point.validAt)).toEqual([
      Date.parse("2026-10-25T00:00:00.000Z"),
      Date.parse("2026-10-25T01:00:00.000Z"),
    ]);
    expect(points[0]?.key).not.toBe(points[1]?.key);
    expect(points[0]?.label).toContain("02h");
    expect(points[1]?.label).toContain("02h");
    expect(points[0]?.label).not.toBe(points[1]?.label);
  });

  it("retient le dernier run officiel strictement antérieur à la première mesure physique de l’heure", () => {
    const validAt = Date.parse("2026-08-12T08:00:00.000Z");
    const measuredAt = Date.parse("2026-08-12T08:10:00.000Z");
    const selections = selectOfficialHourlyTemperaturesBeforeLocalMeasurements([
      { stationId: "mf-1", observedAt: measuredAt, temperature: 17, distanceKm: 1, reliabilityScore: 92 },
      { stationId: "mf-2", observedAt: measuredAt + 20 * 60_000, temperature: 18, distanceKm: 2, reliabilityScore: 92 },
    ], [
      { validAt, temperature: 10, availableAt: Date.parse("2026-08-12T07:00:00.000Z") },
      { validAt, temperature: 99, availableAt: Date.parse("2026-08-12T09:00:00.000Z") },
    ]);

    expect(selections).toEqual([expect.objectContaining({
      validAt,
      earliestPhysicalMeasurementAt: measuredAt,
      status: "selected",
      reason: "selected_before_measurement",
      forecast: expect.objectContaining({ temperature: 10 }),
    })]);
    expect(selectedOfficialHourlyTemperaturePoints(selections)).toEqual([{ validAt, temperature: 10 }]);
  });

  it("échoue fermée pour une disponibilité égale/postérieure ou inconnue, sans inventer de série qualifiée", () => {
    const validAt = Date.parse("2026-08-12T08:00:00.000Z");
    const measuredAt = Date.parse("2026-08-12T08:10:00.000Z");
    const readings = [{ stationId: "mf-1", observedAt: measuredAt, temperature: 17, distanceKm: 1, reliabilityScore: 92 }];
    const equal = selectOfficialHourlyTemperaturesBeforeLocalMeasurements(readings, [
      { validAt, temperature: 10, availableAt: measuredAt },
    ]);
    const later = selectOfficialHourlyTemperaturesBeforeLocalMeasurements(readings, [
      { validAt, temperature: 10, availableAt: measuredAt + 1 },
    ]);
    const unknown = selectOfficialHourlyTemperaturesBeforeLocalMeasurements(readings, [
      { validAt, temperature: 10, availableAt: null },
    ]);

    expect(equal[0]).toMatchObject({ status: "unavailable", reason: "forecast_available_after_measurement", forecast: null });
    expect(later[0]).toMatchObject({ status: "unavailable", reason: "forecast_available_after_measurement", forecast: null });
    expect(unknown[0]).toMatchObject({ status: "unavailable", reason: "forecast_availability_unknown", forecast: null });
    expect(selectedOfficialHourlyTemperaturePoints([...equal, ...later, ...unknown])).toEqual([]);
  });

  it("préserve les deux instants UTC répétés au changement d’heure dans le sélecteur", () => {
    const firstHour = Date.parse("2026-10-25T00:00:00.000Z");
    const secondHour = Date.parse("2026-10-25T01:00:00.000Z");
    const selections = selectOfficialHourlyTemperaturesBeforeLocalMeasurements([
      { stationId: "summer", observedAt: firstHour + 31 * 60_000, temperature: 12, distanceKm: 2, reliabilityScore: 90 },
      { stationId: "winter", observedAt: secondHour + 31 * 60_000, temperature: 11, distanceKm: 2, reliabilityScore: 90 },
    ], [
      { validAt: firstHour, temperature: 13, availableAt: firstHour - 60_000 },
      { validAt: secondHour, temperature: 10, availableAt: secondHour - 60_000 },
    ]);

    expect(selections.map((selection) => selection.validAt)).toEqual([firstHour, secondHour]);
    expect(selections.every((selection) => selection.status === "selected")).toBe(true);
  });
});
