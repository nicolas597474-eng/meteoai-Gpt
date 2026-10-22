/**
 * Security utilities and middleware for MeteoAI
 * Centralized security configurations and helpers
 */

import { ENV } from "./env";
import type { Request, Response, NextFunction } from "express";

// =============================================================================
// RATE LIMITING
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/** Static chunks can number in hundreds in Vite; they must not exhaust API quotas. */
export function isRateLimitedApiPath(path: string): boolean {
  return (path === "/api" || path.startsWith("/api/")) && path !== "/api/health";
}

/**
 * Rate limiting middleware for Express
 * Limits requests per IP address
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const maxRequests = ENV.rateLimitMaxRequests;
  const windowMs = ENV.rateLimitWindowMs;
  
  const key = `rate_limit:${ip}`;
  const entry = rateLimitStore.get(key);
  
  if (!entry || now > entry.resetTime) {
    // Reset the counter
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + windowMs,
    });
    return next();
  }
  
  // Increment counter
  entry.count++;
  
  if (entry.count > maxRequests) {
    res.status(429).json({
      error: "Too Many Requests",
      message: `Rate limit exceeded. Please try again in ${Math.ceil((entry.resetTime - now) / 1000)} seconds.`,
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    });
    return;
  }
  
  next();
}

/**
 * Clear rate limit for a specific IP (useful for testing)
 */
export function clearRateLimit(ip: string) {
  rateLimitStore.delete(`rate_limit:${ip}`);
}

/**
 * Clear all rate limits
 */
export function clearAllRateLimits() {
  rateLimitStore.clear();
}

// =============================================================================
// SECURITY HEADERS
// =============================================================================

/**
 * Origines tierces que le NAVIGATEUR contacte directement (voir client/src).
 *
 * Une origine absente de la CSP n'est pas jointe : le fetch est refusé avant
 * toute requête réseau et l'utilisateur voit une « Erreur réseau » générique
 * alors que sa connexion est saine. Toute nouvelle dépendance navigateur
 * (fetch, iframe) doit donc être déclarée ici ; security.test.ts le vérifie.
 */
/** Recherche de ville Open-Meteo (FavoritesBar, ReliabilityLocationPicker). */
export const GEOCODING_API_ORIGIN = "https://geocoding-api.open-meteo.com";
/** Carte météo Windy intégrée en iframe (WindyMap). */
export const WINDY_EMBED_ORIGIN = "https://embed.windy.com";

const MANUS_ORIGINS = "https://*.manus.space https://*.manus.computer";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${MANUS_ORIGINS}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  `connect-src 'self' ${GEOCODING_API_ORIGIN} ${MANUS_ORIGINS}`,
  `frame-src 'self' ${WINDY_EMBED_ORIGIN}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
].join("; ");

/**
 * La géolocalisation reste réservée à l'application (« Utiliser ma position
 * actuelle », barre de favoris) et à l'embed Windy, qui la demande via
 * allow="geolocation". Micro et caméra restent désactivés.
 */
export const PERMISSIONS_POLICY = `geolocation=(self "${WINDY_EMBED_ORIGIN}"), microphone=(), camera=()`;

/**
 * Security headers middleware
 * Adds common security headers to all responses
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Content Security Policy
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  
  // Other security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  
  // Remove server information
  res.removeHeader("X-Powered-By");
  
  next();
}

// =============================================================================
// INPUT VALIDATION
// =============================================================================

import { z } from "zod";

// Common validation schemas
export const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const locationKeySchema = z.string().regex(/^-?\d{1,3}\.\d{1,6}_-?\d{1,3}\.\d{1,6}$/, {
  message: "Invalid location key format. Expected format: lat_lon (e.g., 48.8566_2.3522)",
});

export const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "Invalid date format. Expected format: YYYY-MM-DD",
});

export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

/**
 * Validate and sanitize a location key
 */
export function validateLocationKey(key: string): string {
  const result = locationKeySchema.safeParse(key);
  if (!result.success) {
    throw new Error(`Invalid location key: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Validate coordinates and return normalized location key
 */
export function validateCoordinates(lat: number, lon: number): { lat: number; lon: number; locationKey: string } {
  const result = coordinateSchema.safeParse({ lat, lon });
  if (!result.success) {
    throw new Error(`Invalid coordinates: ${result.error.message}`);
  }
  
  const locationKey = `${result.data.lat.toFixed(3)}_${result.data.lon.toFixed(3)}`;
  return { ...result.data, locationKey };
}

// =============================================================================
// SANITIZATION
// =============================================================================

/**
 * Sanitize user input to prevent XSS
 */
export function sanitizeString(input: string, maxLength: number = 1000): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  return input
    .trim()
    .substring(0, maxLength)
    .replace(/[<>"'&]/g, '');
}

/**
 * Sanitize object keys and values
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const sanitizedKey = sanitizeString(key, 50);
    
    if (typeof value === 'string') {
      result[sanitizedKey] = sanitizeString(value as string);
    } else if (typeof value === 'object' && value !== null) {
      result[sanitizedKey] = sanitizeObject(value as Record<string, unknown>);
    } else {
      result[sanitizedKey] = value;
    }
  }
  
  return result as T;
}

// =============================================================================
// SESSION SECURITY
// =============================================================================

/**
 * Generate a secure random token
 */
export function generateSecureToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

/**
 * Hash a string using SHA-256
 */
export function hashString(input: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(input).digest('hex');
}

// =============================================================================
// CORS SECURITY
// =============================================================================

export function isAllowedCorsOrigin(origin: string, production = ENV.isProduction): boolean {
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (url.origin !== origin || url.username || url.password) return false;
  const exact = ['https://meteoai-7i8fkmsr.manus.space',
    ...(process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)];
  if (exact.includes(origin)) return true;
  if (production) return false;
  if (['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'].includes(origin)) return true;
  return url.protocol === 'https:' && /^[^.]+\.(?:manus\.space|manus\.computer|manus-asia\.computer|manusvm\.computer|manuscomputer\.ai)$/.test(url.hostname);
}

/**
 * CORS middleware with strict origin validation
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  
  if (origin && isAllowedCorsOrigin(origin)) {
    res.vary('Origin');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  
  next();
}
