import { HOURLY_FORECAST_VARIABLES } from "./forecastVariableCoverage";

export type HourlyValueNormalizationStatus = "valid" | "normalized" | "provider_null" | "field_missing" | "invalid_value" | "unit_mismatch";
export type HourlyValueNormalization = {
  value: number | null;
  status: HourlyValueNormalizationStatus;
  canonicalUnit: string | null;
  rawType: string | null;
  rawValue: string | null;
  rawUnit: string | null;
};

type UnitConversion = { value: number; canonicalUnit: string; changed: boolean } | null;

const VARIABLE_DEFAULT_UNITS: Map<string, string> = new Map(
  HOURLY_FORECAST_VARIABLES.map((definition): [string, string] => [definition.key, definition.defaultUnit || ""]),
);

function safeRawValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 80);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : String(value);
  if (typeof value === "boolean") return String(value);
  return typeof value;
}

function strictFiniteNumber(value: unknown): { value: number; normalized: boolean } | null {
  if (typeof value === "number") return Number.isFinite(value) ? { value, normalized: false } : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? { value: parsed, normalized: true } : null;
}

export function parseHourlyTimestampSeconds(value: unknown): number | null {
  const numeric = strictFiniteNumber(value);
  if (numeric && numeric.value > 0) return numeric.value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return null;
  const datePart = trimmed.slice(0, 10);
  const calendarDate = new Date(`${datePart}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart) return null;
  const timestampMs = Date.parse(trimmed);
  return Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs / 1000 : null;
}

function unitToken(value: string): string {
  return value.trim().toLowerCase().replaceAll("°", "").replaceAll("²", "2").replaceAll(" ", "");
}

function normalizeUnit(variable: string, value: number, rawUnit: string): UnitConversion {
  const unit = unitToken(rawUnit);
  const expected = VARIABLE_DEFAULT_UNITS.get(variable);
  if (expected == null) return null;
  const canonicalUnit = expected;
  const unchanged = () => ({ value, canonicalUnit, changed: false });
  const converted = (next: number) => Number.isFinite(next) ? ({ value: next, canonicalUnit, changed: true }) : null;

  if (["temperature", "apparent_temperature", "dew_point"].includes(variable)) {
    if (["c", "celsius"].includes(unit)) return unchanged();
    if (["f", "fahrenheit"].includes(unit)) return converted((value - 32) * 5 / 9);
    return null;
  }
  if (["precipitation", "rain", "showers"].includes(variable)) {
    if (["mm", "millimeter", "millimeters", "millimetre", "millimetres"].includes(unit)) return unchanged();
    if (["cm", "centimeter", "centimeters", "centimetre", "centimetres"].includes(unit)) return converted(value * 10);
    if (["in", "inch", "inches"].includes(unit)) return converted(value * 25.4);
    return null;
  }
  if (variable === "snowfall") {
    if (["cm", "centimeter", "centimeters", "centimetre", "centimetres"].includes(unit)) return unchanged();
    if (unit === "mm") return converted(value / 10);
    if (["in", "inch", "inches"].includes(unit)) return converted(value * 2.54);
    return null;
  }
  if (["wind_speed", "wind_gust"].includes(variable)) {
    if (["km/h", "kmh", "km/hr", "kmh-1"].includes(unit)) return unchanged();
    if (["m/s", "ms-1", "mps"].includes(unit)) return converted(value * 3.6);
    if (["mph", "mi/h"].includes(unit)) return converted(value * 1.609344);
    if (["kn", "knot", "knots", "kt", "kts"].includes(unit)) return converted(value * 1.852);
    return null;
  }
  if (variable === "wind_direction") {
    if (["", "deg", "degree", "degrees"].includes(unit)) return unchanged();
    return null;
  }
  if (["humidity", "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high"].includes(variable)) {
    return unit === "%" ? unchanged() : null;
  }
  if (variable === "surface_pressure") {
    if (["hpa", "mbar"].includes(unit)) return unchanged();
    if (unit === "pa") return converted(value / 100);
    if (unit === "kpa") return converted(value * 10);
    return null;
  }
  if (variable === "visibility") {
    if (["km", "kilometer", "kilometers", "kilometre", "kilometres"].includes(unit)) return unchanged();
    if (["m", "meter", "meters", "metre", "metres"].includes(unit)) return converted(value / 1000);
    if (["mi", "mile", "miles"].includes(unit)) return converted(value * 1.609344);
    return null;
  }
  if (variable === "weather_code") {
    return ["", "code", "wmo", "wmocode"].includes(unit) ? unchanged() : null;
  }
  if (variable === "uv_index") {
    return ["", "index", "uv", "uvindex"].includes(unit) ? unchanged() : null;
  }
  if (variable === "shortwave_radiation") {
    return ["w/m2", "watt/m2", "watts/m2"].includes(unit) ? unchanged() : null;
  }
  return null;
}

/** Normalize one provider value into MeteoAI's canonical hourly units. */
export function normalizeHourlySourceValue(input: {
  variable: string;
  value: unknown;
  unit: unknown;
}): HourlyValueNormalization {
  const canonicalUnit = VARIABLE_DEFAULT_UNITS.get(input.variable) ?? null;
  const rawUnit = typeof input.unit === "string" ? input.unit : null;
  const base = { canonicalUnit, rawType: input.value == null ? (input.value === null ? "null" : null) : typeof input.value, rawValue: safeRawValue(input.value), rawUnit };
  if (input.value === undefined) return { ...base, value: null, status: "field_missing" };
  if (input.value === null) return { ...base, value: null, status: "provider_null" };
  const parsed = strictFiniteNumber(input.value);
  if (!parsed) return { ...base, value: null, status: "invalid_value" };
  if (canonicalUnit == null) return { ...base, value: null, status: "unit_mismatch" };

  const unitMetadataMissing = rawUnit == null || rawUnit.trim() === "" && canonicalUnit !== "";
  const normalized = normalizeUnit(input.variable, parsed.value, unitMetadataMissing ? canonicalUnit : rawUnit ?? canonicalUnit);
  if (!normalized) return { ...base, value: null, status: "unit_mismatch" };
  return {
    ...base,
    value: normalized.value,
    status: parsed.normalized || normalized.changed ? "normalized" : "valid",
    canonicalUnit,
    rawUnit: unitMetadataMissing ? null : rawUnit,
  };
}
