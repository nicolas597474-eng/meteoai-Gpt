/**
 * Centralized environment configuration for MeteoAI
 * All sensitive configuration is loaded from environment variables
 * NEVER commit actual values to version control
 */

export const ENV = {
  // ============================================================================
  // APPLICATION SETTINGS
  // ============================================================================
  appId: process.env.VITE_APP_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT ?? "3000"),
  
  // ============================================================================
  // SECURITY - SESSION & AUTHENTICATION
  // ============================================================================
  // JWT secret for user session signing
  // Use: Session cookie signing, user authentication tokens
  cookieSecret: process.env.JWT_SECRET ?? "",
  
  // Session cookie name
  cookieName: process.env.COOKIE_NAME ?? "meteoai_session",
  
  // Session duration in milliseconds (default: 1 year)
  sessionDurationMs: parseInt(process.env.SESSION_DURATION_MS ?? "31536000000"),
  
  // ============================================================================
  // SECURITY - NETATMO INTEGRATION
  // ============================================================================
  // Separate secret for Netatmo OAuth state signing
  // Use: Netatmo OAuth state verification
  netatmoStateSecret: process.env.NETATMO_STATE_SECRET ?? process.env.JWT_SECRET ?? "",
  
  // Separate key for Netatmo refresh token encryption
  // Use: Encrypting Netatmo refresh tokens in database
  netatmoEncryptionKey: process.env.NETATMO_ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? "",
  
  // ============================================================================
  // SECURITY - API KEYS
  // ============================================================================
  // Forge API credentials
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  
  // Frontend Forge API (for Google Maps proxy)
  frontendForgeApiUrl: process.env.VITE_FRONTEND_FORGE_API_URL ?? "",
  frontendForgeApiKey: process.env.VITE_FRONTEND_FORGE_API_KEY ?? "",
  
  // ============================================================================
  // DATABASE
  // ============================================================================
  databaseUrl: process.env.DATABASE_URL ?? "",
  
  // ============================================================================
  // OAUTH & AUTHENTICATION
  // ============================================================================
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  oauthPortalUrl: process.env.VITE_OAUTH_PORTAL_URL ?? "",
  
  // ============================================================================
  // NETATMO
  // ============================================================================
  netatmoClientId: process.env.NETATMO_CLIENT_ID ?? "",
  netatmoClientSecret: process.env.NETATMO_CLIENT_SECRET ?? "",
  netatmoRedirectUri: process.env.NETATMO_REDIRECT_URI ?? "https://meteoai-7i8fkmsr.manus.space/api/netatmo/callback",
  
  // ============================================================================
  // EXTERNAL WEATHER APIs (Optional - fallback to simulation if absent)
  // ============================================================================
  openWeatherMapApiKey: process.env.OPENWEATHERMAP_API_KEY ?? "",
  // Legacy variable name; the value is the Météo-France OAuth2 application identifier
  // used as the Basic credential for the portal's client_credentials token exchange.
  // Chemin hérité uniquement : il n’est lu que si AROME_WCS_ENABLED=true réactive le
  // WCS AROME. Le chemin AROME par défaut passe uniquement par Open-Meteo, sans clé.
  meteoFranceOAuthApplicationId: process.env.METEOFRANCE_API_KEY ?? "",
  
  // ============================================================================
  // RATE LIMITING
  // ============================================================================
  // Maximum requests per minute per IP
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? "100"),
  // Rate limit window in milliseconds
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000"),
  
  // ============================================================================
  // CACHE SETTINGS
  // ============================================================================
  // Cache TTL in milliseconds (default: 5 minutes)
  cacheTtlMs: parseInt(process.env.CACHE_TTL_MS ?? "300000"),
  // Maximum cache entries
  cacheMaxEntries: parseInt(process.env.CACHE_MAX_ENTRIES ?? "1000"),
  
  // ============================================================================
  // AXIOS & HTTP
  // ============================================================================
  axiosTimeoutMs: parseInt(process.env.AXIOS_TIMEOUT_MS ?? "10000"),
};

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate that all required environment variables are set
 * Throws an error if any required variable is missing
 */
export function validateRequiredEnv() {
  const errors: string[] = [];
  
  // Required for all environments
  if (!ENV.cookieSecret) {
    errors.push("JWT_SECRET is required for session signing");
  }
  
  if (!ENV.appId) {
    errors.push("VITE_APP_ID is required for application identification");
  }
  
  if (!ENV.oAuthServerUrl && ENV.isProduction) {
    errors.push("OAUTH_SERVER_URL is required in production");
  }
  
  // Required for Netatmo features
  if (!ENV.netatmoStateSecret && ENV.netatmoClientId) {
    errors.push("NETATMO_STATE_SECRET is required when NETATMO_CLIENT_ID is set");
  }
  
  if (!ENV.netatmoEncryptionKey && ENV.netatmoClientId) {
    errors.push("NETATMO_ENCRYPTION_KEY is required when NETATMO_CLIENT_ID is set");
  }
  
  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }
  
  // Warn about optional but recommended variables
  if (!ENV.databaseUrl && ENV.isProduction) {
    console.warn("[ENV] DATABASE_URL is not set - database features will not work");
  }
  
  if (!ENV.forgeApiUrl && ENV.isProduction) {
    console.warn("[ENV] BUILT_IN_FORGE_API_URL is not set - external services will not work");
  }
}

// Validate on import in production
if (ENV.isProduction) {
  validateRequiredEnv();
}
