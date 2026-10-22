import { describe, expect, it } from "vitest";
import { normalizeHourlySourceValue, parseHourlyTimestampSeconds } from "./hourlyValueNormalization";

describe("normalisation horaire explicite des valeurs et unités", () => {
  it("préserve zéro et accepte un nombre décimal textuel strict sans tolérer NaN ou les chaînes ambiguës", () => {
    expect(normalizeHourlySourceValue({ variable: "precipitation", value: 0, unit: "mm" }))
      .toMatchObject({ value: 0, status: "valid", canonicalUnit: "mm" });
    expect(normalizeHourlySourceValue({ variable: "temperature", value: "-2.5", unit: "°C" }))
      .toMatchObject({ value: -2.5, status: "normalized", canonicalUnit: "°C", rawValue: "-2.5" });
    expect(normalizeHourlySourceValue({ variable: "temperature", value: "Infinity", unit: "°C" }))
      .toMatchObject({ value: null, status: "invalid_value" });
    expect(normalizeHourlySourceValue({ variable: "temperature", value: "12 °C", unit: "°C" }))
      .toMatchObject({ value: null, status: "invalid_value" });
  });

  it("convertit uniquement les unités reconnues vers les unités canoniques MeteoAI", () => {
    expect(normalizeHourlySourceValue({ variable: "temperature", value: 68, unit: "°F" }))
      .toMatchObject({ value: 20, status: "normalized", canonicalUnit: "°C" });
    expect(normalizeHourlySourceValue({ variable: "wind_speed", value: 10, unit: "m/s" }))
      .toMatchObject({ value: 36, status: "normalized", canonicalUnit: "km/h" });
    expect(normalizeHourlySourceValue({ variable: "precipitation", value: 1, unit: "inch" }))
      .toMatchObject({ value: 25.4, status: "normalized", canonicalUnit: "mm" });
    expect(normalizeHourlySourceValue({ variable: "surface_pressure", value: 101200, unit: "Pa" }))
      .toMatchObject({ value: 1012, status: "normalized", canonicalUnit: "hPa" });
    expect(normalizeHourlySourceValue({ variable: "visibility", value: 24000, unit: "m" }))
      .toMatchObject({ value: 24, status: "normalized", canonicalUnit: "km" });
  });

  it("sépare les absences fournisseur, les champs absents et les unités non prises en charge", () => {
    expect(normalizeHourlySourceValue({ variable: "precipitation", value: null, unit: "mm" }).status).toBe("provider_null");
    expect(normalizeHourlySourceValue({ variable: "precipitation", value: undefined, unit: "mm" }).status).toBe("field_missing");
    expect(normalizeHourlySourceValue({ variable: "wind_speed", value: 10, unit: "furlong/hour" }))
      .toMatchObject({ value: null, status: "unit_mismatch", rawUnit: "furlong/hour" });
  });

  it("accepte les timestamps Unix textuels et les dates ISO zonées, mais rejette une heure locale ambiguë", () => {
    const unixSeconds = Date.parse("2026-10-25T00:00:00.000Z") / 1000;
    expect(parseHourlyTimestampSeconds(unixSeconds)).toBe(unixSeconds);
    expect(parseHourlyTimestampSeconds(String(unixSeconds))).toBe(unixSeconds);
    expect(parseHourlyTimestampSeconds("2026-10-25T02:00:00+02:00")).toBe(unixSeconds);
    expect(parseHourlyTimestampSeconds("2026-10-25T02:00:00")).toBeNull();
    expect(parseHourlyTimestampSeconds("2026-02-30T12:00:00Z")).toBeNull();
    expect(parseHourlyTimestampSeconds("Infinity")).toBeNull();
  });
});
