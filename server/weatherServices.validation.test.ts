import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { VALIDATION_WEATHER_MODELS, WEATHER_SERVICES } from "./weatherServices";

describe("validation weather models", () => {
  it("keeps candidate models separate from the eight active experts", () => {
    expect(WEATHER_SERVICES.expert).toHaveLength(8);
    expect(VALIDATION_WEATHER_MODELS.map((model) => model.name)).toEqual([
      "DMI HARMONIE-DINI",
      "ICON-D2",
      "ECMWF AIFS",
      "ECMWF ENS",
      "AIFS ENS",
    ]);
    const activeNames = WEATHER_SERVICES.expert.map((model) => model.name);
    expect(VALIDATION_WEATHER_MODELS.every((model) => !activeNames.includes(model.name))).toBe(true);
  });

  it("applique une reprise contrôlée à la collecte horaire des modèles actifs", () => {
    const source = readFileSync(new URL("./weatherServices.ts", import.meta.url), "utf8");
    expect(source).toContain("fetchWeather(url.toString(), {}, { timeoutMs: 12_000, attempts: 2 })");
  });

  it("sépare le snapshot modèle current de la série horaire et conserve le code WMO", () => {
    const source = readFileSync(
      new URL("./weatherServices.ts", import.meta.url),
      "utf8"
    );
    const hourlyStart = source.indexOf(
      "export async function collectHourlyForecast("
    );
    const currentStart = source.indexOf(
      "export async function collectCurrentWeatherSnapshot("
    );
    const currentEnd = source.indexOf(
      "export type HourlyModelForecast",
      currentStart
    );
    const hourlySource = source.slice(hourlyStart, currentStart);
    const currentSnapshotSource = source.slice(currentStart, currentEnd);

    expect(hourlySource).toContain('url.searchParams.set("hourly"');
    expect(hourlySource).toContain(
      'url.searchParams.set("timeformat", "unixtime")'
    );
    expect(hourlySource).toContain("validAt + 60 * 60_000 <= now");
    expect(hourlySource).not.toContain('url.searchParams.set("current"');
    expect(hourlySource).not.toContain("isCurrent");
    expect(currentSnapshotSource).toContain('url.searchParams.set("current"');
    expect(currentSnapshotSource).not.toContain(
      'url.searchParams.set("hourly"'
    );
    expect(currentSnapshotSource).toContain(
      'sourceKind: "model_current_snapshot"'
    );
    expect(currentSnapshotSource).toContain("capturedAt");
    expect(currentSnapshotSource).toContain("conditionFromWmoWeatherCode");
  });
});
