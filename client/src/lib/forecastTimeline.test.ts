import { describe, expect, it } from "vitest";
import {
  formatOptionalForecastValue,
  getInitialForecastTimelineSelection,
  getSelectedForecastHourIndex,
  groupOfficialHourlyForecastByDate,
  isOfficialSevenModelSource,
  selectForecastDay,
  selectForecastHour,
  type ForecastTimelineSelection,
} from "./forecastTimeline";

type TestHour = { date?: string | null; hour?: string | null; validAt?: number | null; temp?: number | null };

const hours: TestHour[] = [
  { date: "2026-10-03", hour: "08:00", validAt: Date.parse("2026-10-03T06:00:00Z"), temp: 0 },
  { date: "2026-10-03", hour: "09:00", validAt: Date.parse("2026-10-03T07:00:00Z"), temp: 12 },
  { date: "2026-10-04", hour: "08:00", validAt: Date.parse("2026-10-04T06:00:00Z"), temp: 8 },
];

describe("prévisions horaires organisées par jour", () => {
  it("regroupe les dates explicites en conservant les index source et l’ordre de la série", () => {
    const grouped = groupOfficialHourlyForecastByDate(hours);
    expect(grouped.days.map(({ date, hours: dayHours }) => [date, dayHours.map(({ index }) => index)])).toEqual([
      ["2026-10-03", [0, 1]],
      ["2026-10-04", [2]],
    ]);
    expect(grouped.undatedHours).toBe(0);
  });

  it("ne devine pas une date locale quand elle manque ou est invalide", () => {
    const grouped = groupOfficialHourlyForecastByDate([
      { hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00Z") },
      { date: "2026-02-30", hour: "10:00" },
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00Z") },
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T01:00:00Z") },
    ]);
    expect(grouped.undatedHours).toBe(2);
    expect(grouped.days).toHaveLength(1);
    expect(grouped.days[0].hours.map(({ index, hour }) => [index, hour.validAt])).toEqual([
      [2, Date.parse("2026-10-25T00:00:00Z")],
      [3, Date.parse("2026-10-25T01:00:00Z")],
    ]);
  });

  it("choisit la journée et l’heure actives séparément, puis ouvre le jour sélectionné", () => {
    const grouped = groupOfficialHourlyForecastByDate(hours).days;
    const initial = getInitialForecastTimelineSelection(grouped, 1);
    expect(initial).toEqual({ dayDate: "2026-10-03", hourIndex: 1, expanded: true });

    const tomorrow = selectForecastDay(initial, grouped[1], 1);
    expect(tomorrow).toEqual({ dayDate: "2026-10-04", hourIndex: 2, expanded: true });
    expect(selectForecastDay(tomorrow, grouped[1], 1).expanded).toBe(false);
    expect(getSelectedForecastHourIndex(tomorrow, grouped[1], 1)).toBe(2);
  });

  it("permet de choisir une heure sans changer le jour ni l’état actif horaire", () => {
    const grouped = groupOfficialHourlyForecastByDate(hours).days;
    const selectedDay: ForecastTimelineSelection = { dayDate: "2026-10-03", hourIndex: 0, expanded: true };
    expect(selectForecastHour(selectedDay, grouped[0], 1)).toEqual({ dayDate: "2026-10-03", hourIndex: 1, expanded: true });
    expect(selectForecastHour(selectedDay, grouped[0], 99)).toBe(selectedDay);
  });

  it("affiche un zéro météo valide et conserve l’indisponibilité des valeurs nulles", () => {
    expect(formatOptionalForecastValue(0, 1, " mm")).toBe("0.0 mm");
    expect(formatOptionalForecastValue(0, 0, "°")).toBe("0°");
    expect(formatOptionalForecastValue(null, 1, " mm")).toBe("—");
    expect(formatOptionalForecastValue(undefined, 0, "%")).toBe("—");
    expect(formatOptionalForecastValue(Number.NaN, 1, " km/h")).toBe("—");
  });

  it("n’accepte un accord intermodèles que si le contrat exclut explicitement Best Match", () => {
    expect(isOfficialSevenModelSource({ source: "official_seven_models", bestMatchIncluded: false })).toBe(true);
    expect(isOfficialSevenModelSource({ source: "official_seven_models", bestMatchIncluded: true })).toBe(false);
    expect(isOfficialSevenModelSource({ source: "best_match", bestMatchIncluded: false })).toBe(false);
    expect(isOfficialSevenModelSource(undefined)).toBe(false);
  });
});
