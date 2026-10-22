import { describe, expect, it, beforeAll, vi } from "vitest";
import {
  createNetatmoState,
  decryptNetatmoRefreshToken,
  encryptNetatmoRefreshToken,
  hashNetatmoState,
  verifyNetatmoState,
  NETATMO_STATE_TTL_MS,
} from "./netatmoOAuth";
import { getNetatmoCallbackDiagnostic } from "./netatmoOAuthRoutes";

// Mock the ENV module before importing netatmoOAuth
vi.mock("./_core/env", () => ({
  ENV: {
    cookieSecret: "test_jwt_secret_key_for_mocking",
    appId: "test_app_id",
    databaseUrl: "",
    oAuthServerUrl: "http://test-oauth-server.com",
    ownerOpenId: "test_owner_openid",
    isProduction: false,
    forgeApiUrl: "http://test-forge-api.com",
    forgeApiKey: "test_forge_api_key",
    openWeatherMapApiKey: "",
    meteoFranceOAuthApplicationId: "",
    netatmoStateSecret: "test_jwt_secret_key_for_mocking",
    netatmoEncryptionKey: "test_jwt_secret_key_for_mocking",
  },
}));

describe("s\u00e9curit\u00e9 OAuth Netatmo", () => {
  it("valide un \u00e9tat sign\u00e9 dans sa fen\u00eatre de validit\u00e9", () => {
    const now = Date.now();
    const state = createNetatmoState(42, now);
    // Should be valid within TTL (10 minutes)
    expect(verifyNetatmoState(state, now + 30_000)).toMatchObject({ userId: 42, issuedAt: now });
    expect(verifyNetatmoState(state, now + 5 * 60_000)).toMatchObject({ userId: 42, issuedAt: now });
  });

  it("rejette un \u00e9tat alt\u00e9r\u00e9", () => {
    const now = Date.now();
    const state = createNetatmoState(42, now);
    // Test with tampered state (extra character)
    expect(verifyNetatmoState(`${state}x`, now)).toBeNull();
  });

  it("rejette un \u00e9tat expir\u00e9", () => {
    const now = Date.now();
    const oldNow = now - 11 * 60_000; // 11 minutes ago
    const state = createNetatmoState(42, oldNow);
    // State was issued 11 minutes ago, checking now should fail (TTL is 10 minutes)
    expect(verifyNetatmoState(state, now)).toBeNull();
  });

  it("rejette un \u00e9tat du futur", () => {
    const now = Date.now();
    const futureNow = now + 120_000; // 2 minutes in the future
    const state = createNetatmoState(42, futureNow);
    // State is from the future, checking now should fail
    expect(verifyNetatmoState(state, now)).toBeNull();
  });

  it("produit une empreinte stable \u00e0 conserver sans exposer l\u0019\u00e9tat sign\u00e9", () => {
    const state = createNetatmoState(42, Date.now());
    const hash = hashNetatmoState(state);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(state);
    expect(hashNetatmoState(state)).toBe(hash);
  });

  it("porte l\u2019identit\u00e9 dans l\u2019\u00e9tat sign\u00e9 plut\u00f4t que dans un contexte de session transitoire", () => {
    const state = createNetatmoState(42, Date.now());
    expect(verifyNetatmoState(state)?.userId).toBe(42);
    expect(hashNetatmoState(state)).toHaveLength(64);
  });

  it("chiffre le refresh token sans le conserver en clair", () => {
    const token = "refresh-token-test";
    const encrypted = encryptNetatmoRefreshToken(token);
    expect(encrypted).not.toContain(token);
    expect(decryptNetatmoRefreshToken(encrypted)).toBe(token);
  });

  it("distingue un refus mobile Netatmo de l\u2019absence de code", () => {
    expect(getNetatmoCallbackDiagnostic({
      code: undefined,
      state: "etat-mobile",
      netatmoError: "access_denied",
      verifiedState: { userId: 42 },
    })).toBe("netatmo_access_denied");
    expect(getNetatmoCallbackDiagnostic({
      code: undefined,
      state: undefined,
      netatmoError: undefined,
      verifiedState: null,
    })).toBe("code_absent");
  });

  it("ne consid\u00e8re pas un code fournisseur comme une preuve de callback sans state sign\u00e9", () => {
    expect(getNetatmoCallbackDiagnostic({
      code: "code-netatmo",
      state: undefined,
      netatmoError: undefined,
      verifiedState: null,
    })).toBe("state_absent");
  });

  it("n expose pas de texte non suer provenant du fournisseur", () => {
    expect(getNetatmoCallbackDiagnostic({
      code: undefined,
      state: "etat",
      netatmoError: "access denied <script>",
      verifiedState: { userId: 42 },
    })).toBe("netatmo_accessdeniedscript");
  });

  it("accepte un \u00e9tat \u00e0 la limite du TTL", () => {
    const now = Date.now();
    const state = createNetatmoState(42, now);
    // Should be valid at exactly TTL boundary (10 minutes)
    expect(verifyNetatmoState(state, now + NETATMO_STATE_TTL_MS - 1)).toMatchObject({ userId: 42, issuedAt: now });
    // Should fail just past TTL
    expect(verifyNetatmoState(state, now + NETATMO_STATE_TTL_MS + 1)).toBeNull();
  });
});
