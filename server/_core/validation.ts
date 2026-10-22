/**
 * Input Validation Middleware and Utilities
 * Centralized validation for all tRPC procedures
 */

import { z, ZodError } from "zod";
import { TRPCError } from "@trpc/server";
import { ENV } from "./env";

// =============================================================================
// VALIDATION ERROR HANDLING
// =============================================================================

/**
 * Convert ZodError to user-friendly error message
 */
export function formatZodError(error: ZodError): string {
  return error.issues
    .map((err) => {
      const path = err.path.join(".");
      const message = err.message;
      return `${path || "entrée"}: ${message}`;
    })
    .join(", ");
}

/**
 * Create a TRPCError from ZodError
 */
export function zodErrorToTRPCError(error: ZodError): TRPCError {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: `Validation failed: ${formatZodError(error)}`,
    cause: error,
  });
}

// =============================================================================
// VALIDATION MIDDLEWARE
// =============================================================================

/**
 * Create a validation middleware for tRPC procedures
 */
export function createValidationMiddleware<T extends z.ZodTypeAny>(
  schema: T
): (opts: { input: unknown }) => Promise<{ input: z.infer<T> }> {
  return async (opts) => {
    const result = schema.safeParse(opts.input);
    
    if (!result.success) {
      throw zodErrorToTRPCError(result.error);
    }
    
    return {
      input: result.data,
    };
  };
}

/**
 * Create a procedure with built-in validation
 */
export function createValidatedProcedure<T extends z.ZodTypeAny>(
  schema: T
) {
  return {
    input: schema,
    middleware: createValidationMiddleware(schema),
  };
}

// =============================================================================
// COMMON SCHEMAS FOR REUSE
// =============================================================================

// Re-export from weatherInput for convenience
export {
  latitudeSchema,
  longitudeSchema,
  optionalCoordinatesSchema,
  requiredCoordinatesSchema,
  dateStringSchema,
  optionalDateSchema,
  dateRangeSchema,
  locationKeySchema,
  locationSchema,
  paginationSchema,
  temperatureSchema,
  precipitationSchema,
  windSpeedSchema,
  humiditySchema,
  cloudCoverSchema,
  pressureSchema,
  visibilitySchema,
  forecastInputSchema,
  historyInputSchema,
  stationIdSchema,
  stationSourceSchema,
  stationInputSchema,
  rankingInputSchema,
  comparisonInputSchema,
  searchInputSchema,
  filterInputSchema,
  favoriteLocationSchema,
  favoriteInputSchema,
  userSettingsSchema,
  validateCoordinates,
  validateOptionalCoordinates,
  validateDate,
  validateLocationKey,
  createLocationKey,
} from "../weatherInput";

// =============================================================================
// SANITIZATION UTILITIES
// =============================================================================

/**
 * Sanitize and validate a string input
 */
export function sanitizeAndValidateString(
  input: unknown,
  schema: z.ZodString,
  fieldName: string
): string {
  if (typeof input !== 'string') {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${fieldName}: Expected string, received ${typeof input}`,
    });
  }
  
  const result = schema.safeParse(input);
  if (!result.success) {
    throw zodErrorToTRPCError(result.error);
  }
  
  return result.data;
}

/**
 * Sanitize and validate a number input
 */
export function sanitizeAndValidateNumber(
  input: unknown,
  schema: z.ZodNumber,
  fieldName: string
): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${fieldName}: Expected finite number, received ${typeof input}`,
    });
  }
  
  const result = schema.safeParse(input);
  if (!result.success) {
    throw zodErrorToTRPCError(result.error);
  }
  
  return result.data;
}

/**
 * Validate an object input
 */
export function validateObjectInput<T extends z.ZodTypeAny>(
  input: unknown,
  schema: T,
  fieldName: string
): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${fieldName}: ${formatZodError(result.error)}`,
    });
  }
  return result.data;
}

// =============================================================================
// RATE LIMIT VALIDATION
// =============================================================================

/**
 * Validate rate limit configuration
 */
export function validateRateLimitConfig() {
  if (ENV.rateLimitMaxRequests <= 0) {
    throw new Error("RATE_LIMIT_MAX_REQUESTS must be greater than 0");
  }
  
  if (ENV.rateLimitWindowMs <= 0) {
    throw new Error("RATE_LIMIT_WINDOW_MS must be greater than 0");
  }
}

// =============================================================================
// ENVIRONMENT VALIDATION
// =============================================================================

/**
 * Validate that required configuration is present
 */
export function validateConfiguration() {
  const errors: string[] = [];
  
  // Check rate limiting config
  try {
    validateRateLimitConfig();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  
  // Check cache config
  if (ENV.cacheTtlMs <= 0) {
    errors.push("CACHE_TTL_MS must be greater than 0");
  }
  
  if (ENV.cacheMaxEntries <= 0) {
    errors.push("CACHE_MAX_ENTRIES must be greater than 0");
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

// Validate on import in production
if (ENV.isProduction) {
  validateConfiguration();
}
