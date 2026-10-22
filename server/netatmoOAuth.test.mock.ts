// Mock for netatmoOAuth tests
// This file provides mock implementations for the ENV module

import { vi } from 'vitest';

// Mock the ENV module
export const mockENV = {
  cookieSecret: 'test_jwt_secret_key_for_mocking',
  appId: 'test_app_id',
  databaseUrl: '',
  oAuthServerUrl: 'http://test-oauth-server.com',
  ownerOpenId: 'test_owner_openid',
  isProduction: false,
  forgeApiUrl: 'http://test-forge-api.com',
  forgeApiKey: 'test_forge_api_key',
  openWeatherMapApiKey: '',
  meteoFranceOAuthApplicationId: '',
};

// Export as ENV for compatibility
export const ENV = mockENV;

// Mock process.env for the actual module
vi.stubEnv('JWT_SECRET', 'test_jwt_secret_key_for_mocking');
vi.stubEnv('VITE_APP_ID', 'test_app_id');
vi.stubEnv('OAUTH_SERVER_URL', 'http://test-oauth-server.com');
vi.stubEnv('DATABASE_URL', '');
vi.stubEnv('OWNER_OPEN_ID', 'test_owner_openid');
vi.stubEnv('BUILT_IN_FORGE_API_URL', 'http://test-forge-api.com');
vi.stubEnv('BUILT_IN_FORGE_API_KEY', 'test_forge_api_key');
vi.stubEnv('NETATMO_CLIENT_ID', 'test_netatmo_client_id');
vi.stubEnv('NETATMO_CLIENT_SECRET', 'test_netatmo_client_secret');
vi.stubEnv('NETATMO_REDIRECT_URI', 'http://localhost:3000/api/netatmo/callback');
