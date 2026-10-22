import crypto from "crypto";
import { ENV } from "./_core/env";
import { createNetatmoOAuthState } from "./db";

/**
 * Netatmo OAuth Configuration
 * Uses separate secrets for state signing and token encryption
 */

export const NETATMO_REDIRECT_URI = ENV.netatmoRedirectUri || "https://meteoai-7i8fkmsr.manus.space/api/netatmo/callback";
export const NETATMO_SCOPE = "read_station";
export const NETATMO_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Get the signing key for Netatmo OAuth state
 * Uses NETATMO_STATE_SECRET if available, falls back to JWT_SECRET
 */
function getStateSigningKey(): Buffer {
  const secret = ENV.netatmoStateSecret || ENV.cookieSecret;
  if (!secret) {
    throw new Error("NETATMO_STATE_SECRET or JWT_SECRET is required for Netatmo OAuth state");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Get the encryption key for Netatmo refresh tokens
 * Uses NETATMO_ENCRYPTION_KEY if available, falls back to JWT_SECRET
 */
function getEncryptionKey(): Buffer {
  const key = ENV.netatmoEncryptionKey || ENV.cookieSecret;
  if (!key) {
    throw new Error("NETATMO_ENCRYPTION_KEY or JWT_SECRET is required for Netatmo token encryption");
  }
  // Ensure key is 32 bytes for AES-256
  return crypto.createHash("sha256").update(key).digest();
}

/**
 * Create a signed Netatmo OAuth state
 * State format: userId.issuedAt.nonce.signature
 */
export function createNetatmoState(userId: number, now = Date.now()): string {
  const payload = `${userId}.${now}.${crypto.randomBytes(24).toString("base64url")}`;
  const signature = crypto.createHmac("sha256", getStateSigningKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Verify a Netatmo OAuth state
 * Returns null if invalid, expired, or signature doesn't match
 */
export function verifyNetatmoState(state: string, now = Date.now()): { userId: number; issuedAt: number } | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  
  const [userIdRaw, issuedAtRaw, nonce, signature] = parts;
  const payload = `${userIdRaw}.${issuedAtRaw}.${nonce}`;
  const expected = crypto.createHmac("sha256", getStateSigningKey()).update(payload).digest("base64url");
  
  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  
  const userId = Number(userIdRaw);
  const issuedAt = Number(issuedAtRaw);
  
  // Validate userId and issuedAt are valid numbers
  if (!Number.isInteger(userId) || !Number.isFinite(issuedAt)) {
    return null;
  }
  
  // Validate timestamp: not in the future (with 60s grace period) and not expired
  // Use the provided 'now' parameter for consistency with tests
  if (issuedAt > now + 60_000) {
    // State is from the future (more than 60s ahead)
    return null;
  }
  if (now - issuedAt > NETATMO_STATE_TTL_MS) {
    // State has expired (older than TTL = 10 minutes)
    return null;
  }
  
  return { userId, issuedAt };
}

/**
 * Create a hash of the Netatmo state for storage
 * Used to store state in database without exposing the signed state
 */
export function hashNetatmoState(state: string): string {
  return crypto.createHash("sha256").update(state).digest("hex");
}

/**
 * Encrypt a Netatmo refresh token for storage
 * Uses AES-256-GCM encryption
 */
export function encryptNetatmoRefreshToken(refreshToken: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96 bits for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

/**
 * Decrypt a Netatmo refresh token
 * Throws an error if decryption fails
 */
export function decryptNetatmoRefreshToken(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted Netatmo token payload");
  }
  
  const [ivRaw, tagRaw, encryptedRaw] = parts.map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), ivRaw);
  decipher.setAuthTag(tagRaw);
  return Buffer.concat([decipher.update(encryptedRaw), decipher.final()]).toString("utf8");
}

/**
 * Start Netatmo OAuth authorization flow
 * Generates a signed state and stores it in the database
 */
export async function startNetatmoAuthorization(userId: number): Promise<string> {
  const state = createNetatmoState(userId);
  await createNetatmoOAuthState(hashNetatmoState(state), userId, new Date(Date.now() + NETATMO_STATE_TTL_MS));
  
  const authorizationUrl = new URL("https://api.netatmo.com/oauth2/authorize");
  authorizationUrl.searchParams.set("client_id", ENV.netatmoClientId || "");
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", NETATMO_REDIRECT_URI);
  authorizationUrl.searchParams.set("scope", NETATMO_SCOPE);
  authorizationUrl.searchParams.set("state", state);
  
  return authorizationUrl.toString();
}
