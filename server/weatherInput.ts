/**
 * Weather Input Validation Schemas
 * Centralized Zod schemas for validating all weather-related inputs
 */

import { z } from "zod";

// =============================================================================
// COORDINATE SCHEMAS
// =============================================================================

export const latitudeSchema = z.number().finite().min(-90).max(90);
export const longitudeSchema = z.number().finite().min(-180).max(180);

export const optionalCoordinatesSchema = z.object({
  lat: latitudeSchema.optional(),
  lon: longitudeSchema.optional(),
}).refine(
  ({ lat, lon }) => (lat === undefined) === (lon === undefined),
  { message: "Les coordonn\u00e9es latitude et longitude doivent \u00eatre fournies ensemble." }
);

export const requiredCoordinatesSchema = z.object({
  lat: latitudeSchema,
  lon: longitudeSchema,
});

// =============================================================================
// DATE SCHEMAS
// =============================================================================

export const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "Invalid date format. Expected YYYY-MM-DD",
});

export const optionalDateSchema = dateStringSchema.optional();

export const dateRangeSchema = z.object({
  startDate: dateStringSchema,
  endDate: dateStringSchema,
}).refine(
  ({ startDate, endDate }) => startDate <= endDate,
  { message: "startDate must be before or equal to endDate" }
);

// =============================================================================
// LOCATION SCHEMAS
// =============================================================================

export const locationKeySchema = z.string().regex(/^-?\d{1,3}\.\d{1,6}_-?\d{1,3}\.\d{1,6}$/, {
  message: "Invalid location key format. Expected lat_lon format (e.g., 48.856_2.352)",
});

export const locationSchema = z.object({
  lat: latitudeSchema,
  lon: longitudeSchema,
});

// =============================================================================
// PAGINATION SCHEMAS
// =============================================================================

export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

// =============================================================================
// WEATHER PARAMETER SCHEMAS
// =============================================================================

export const temperatureSchema = z.number().finite().min(-100).max(100);
export const precipitationSchema = z.number().finite().nonnegative();
export const windSpeedSchema = z.number().finite().nonnegative();
export const humiditySchema = z.number().finite().min(0).max(100);
export const cloudCoverSchema = z.number().finite().min(0).max(100);
export const pressureSchema = z.number().finite().positive();
export const visibilitySchema = z.number().finite().nonnegative();

// =============================================================================
// BASE COORDINATES SCHEMA (for reuse)
// =============================================================================

export const baseCoordinatesSchema = z.object({
  lat: latitudeSchema.optional(),
  lon: longitudeSchema.optional(),
}).refine(
  ({ lat, lon }) => (lat === undefined) === (lon === undefined),
  { message: "Both lat and lon must be provided together" }
);

// =============================================================================
// FORECAST SCHEMAS
// =============================================================================

export const forecastInputSchema = baseCoordinatesSchema.safeExtend({
  date: dateStringSchema.optional(),
});

export const historyInputSchema = baseCoordinatesSchema.safeExtend({
  days: z.number().int().positive().min(1).max(30).default(7),
});

// =============================================================================
// STATION SCHEMAS
// =============================================================================

export const stationIdSchema = z.string().min(1).max(64);
export const stationSourceSchema = z.enum(["meteofrance", "netatmo", "personal", "manual"]);

export const stationInputSchema = baseCoordinatesSchema.safeExtend({
  stationId: stationIdSchema.optional(),
  source: stationSourceSchema.optional(),
});

// =============================================================================
// RANKING & COMPARISON SCHEMAS
// =============================================================================

export const rankingInputSchema = baseCoordinatesSchema.safeExtend({
  days: z.number().int().positive().min(1).max(365).default(30),
});

export const comparisonInputSchema = baseCoordinatesSchema.safeExtend({
  model1: z.string().min(1),
  model2: z.string().min(1),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
});

// =============================================================================
// SEARCH & FILTER SCHEMAS
// =============================================================================

export const searchInputSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().positive().max(50).default(10),
});

export const filterInputSchema = z.object({
  source: z.array(z.enum(["meteofrance", "netatmo", "personal", "manual"])).optional(),
  minDistance: z.number().nonnegative().optional(),
  maxDistance: z.number().positive().optional(),
  hasTemperature: z.boolean().optional(),
  hasPrecipitation: z.boolean().optional(),
});

// =============================================================================
// FAVORITES SCHEMAS
// =============================================================================

export const favoriteLocationSchema = z.object({
  name: z.string().min(1).max(100),
  lat: latitudeSchema,
  lon: longitudeSchema,
});

export const favoriteInputSchema = baseCoordinatesSchema.safeExtend({
  locationId: z.number().int().positive().optional(),
  name: z.string().min(1).max(100).optional(),
});

// =============================================================================
// SETTINGS SCHEMAS
// =============================================================================

export const userSettingsSchema = z.object({
  units: z.enum(["metric", "imperial"]).default("metric"),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  language: z.enum(["fr", "en"]).default("fr"),
  notifications: z.object({
    weatherAlerts: z.boolean().default(true),
    dailyForecast: z.boolean().default(true),
    weeklyReport: z.boolean().default(false),
  }).default({
    weatherAlerts: true,
    dailyForecast: true,
    weeklyReport: false,
  }),
});

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

/**
 * Validate and parse coordinates
 */
export function validateCoordinates(input: { lat?: number; lon?: number }): { lat: number; lon: number } {
  const result = requiredCoordinatesSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid coordinates: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Validate and parse optional coordinates
 */
export function validateOptionalCoordinates(input: { lat?: number; lon?: number }): { lat?: number; lon?: number } {
  const result = optionalCoordinatesSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid coordinates: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Validate and parse date string
 */
export function validateDate(date: string): string {
  const result = dateStringSchema.safeParse(date);
  if (!result.success) {
    throw new Error(`Invalid date: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Validate and parse location key
 */
export function validateLocationKey(key: string): string {
  const result = locationKeySchema.safeParse(key);
  if (!result.success) {
    throw new Error(`Invalid location key: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Create a location key from coordinates
 */
export function createLocationKey(lat: number, lon: number): string {
  const validated = validateCoordinates({ lat, lon });
  return `${validated.lat.toFixed(3)}_${validated.lon.toFixed(3)}`;
}

// =============================================================================
// EXPORT ALL SCHEMAS
// =============================================================================

export const schemas = {
  // Coordinates
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  optionalCoordinates: optionalCoordinatesSchema,
  requiredCoordinates: requiredCoordinatesSchema,
  
  // Dates
  dateString: dateStringSchema,
  optionalDate: optionalDateSchema,
  dateRange: dateRangeSchema,
  
  // Location
  locationKey: locationKeySchema,
  location: locationSchema,
  
  // Pagination
  pagination: paginationSchema,
  
  // Weather parameters
  temperature: temperatureSchema,
  precipitation: precipitationSchema,
  windSpeed: windSpeedSchema,
  humidity: humiditySchema,
  cloudCover: cloudCoverSchema,
  pressure: pressureSchema,
  visibility: visibilitySchema,
  
  // Forecast
  forecastInput: forecastInputSchema,
  historyInput: historyInputSchema,
  
  // Station
  stationId: stationIdSchema,
  stationSource: stationSourceSchema,
  stationInput: stationInputSchema,
  
  // Ranking
  rankingInput: rankingInputSchema,
  comparisonInput: comparisonInputSchema,
  
  // Search
  searchInput: searchInputSchema,
  filterInput: filterInputSchema,
  
  // Favorites
  favoriteLocation: favoriteLocationSchema,
  favoriteInput: favoriteInputSchema,
  
  // Settings
  userSettings: userSettingsSchema,
};
