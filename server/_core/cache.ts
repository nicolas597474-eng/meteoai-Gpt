/**
 * Simple in-memory cache for MeteoAI
 * Uses LRU (Least Recently Used) eviction policy
 * Thread-safe for single Node.js process
 */

import { ENV } from "./env";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  accessedAt: number;
}

export class LRUCache<K, V> {
  private map: Map<K, CacheEntry<V>>;
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number = ENV.cacheMaxEntries, ttlMs: number = ENV.cacheTtlMs) {
    this.map = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Get a value from the cache
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    
    if (!entry) {
      return undefined;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    
    // Update access time for LRU
    entry.accessedAt = Date.now();
    
    return entry.value;
  }

  /**
   * Set a value in the cache
   */
  set(key: K, value: V): void {
    // If key exists, update it
    if (this.map.has(key)) {
      this.map.set(key, {
        value,
        expiresAt: Date.now() + this.ttlMs,
        accessedAt: Date.now(),
      });
      return;
    }
    
    // If at capacity, remove oldest (LRU)
    if (this.map.size >= this.maxSize) {
      let oldestKey: K | undefined;
      let oldestTime = Infinity;
      
      for (const [k, entry] of Array.from(this.map.entries())) {
        if (entry.accessedAt < oldestTime) {
          oldestTime = entry.accessedAt;
          oldestKey = k;
        }
      }
      
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    
    // Add new entry
    this.map.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
      accessedAt: Date.now(),
    });
  }

  /**
   * Delete a value from the cache
   */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Get the number of entries in the cache
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * Check if a key exists in the cache (and is not expired)
   */
  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) {
      return false;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return false;
    }
    
    return true;
  }
}

// =============================================================================
// GLOBAL CACHE INSTANCES
// =============================================================================

// Cache for weather forecasts
export const forecastCache = new LRUCache<string, any>(ENV.cacheMaxEntries, ENV.cacheTtlMs);

// Cache for weather observations
export const observationCache = new LRUCache<string, any>(ENV.cacheMaxEntries, ENV.cacheTtlMs);

// Cache for station data
export const stationCache = new LRUCache<string, any>(ENV.cacheMaxEntries, ENV.cacheTtlMs);

// Cache for hourly forecasts
export const hourlyForecastCache = new LRUCache<string, any>(ENV.cacheMaxEntries, ENV.cacheTtlMs);

// Cache for ranking data
export const rankingCache = new LRUCache<string, any>(ENV.cacheMaxEntries, ENV.cacheTtlMs);

// =============================================================================
// CACHE KEY GENERATORS
// =============================================================================

/**
 * Generate a cache key for forecast data
 */
export function forecastCacheKey(locationKey: string, date: string): string {
  return `forecast:${locationKey}:${date}`;
}

/**
 * Generate a cache key for observation data
 */
export function observationCacheKey(locationKey: string, date: string): string {
  return `observation:${locationKey}:${date}`;
}

/**
 * Generate a cache key for hourly forecast data
 */
export function hourlyForecastCacheKey(locationKey: string, date: string): string {
  return `hourly:${locationKey}:${date}`;
}

/**
 * Generate a cache key for station data
 */
export function stationCacheKey(stationId: string): string {
  return `station:${stationId}`;
}

/**
 * Generate a cache key for ranking data
 */
export function rankingCacheKey(locationKey: string): string {
  return `ranking:${locationKey}`;
}

// =============================================================================
// CACHED FUNCTION WRAPPERS
// =============================================================================

/**
 * Wrap a function with caching
 * @param cache - The cache instance to use
 * @param keyFn - Function to generate cache key from arguments
 * @param fn - The function to cache
 */
export function withCache<K extends string | number, V>(
  cache: LRUCache<K, V>,
  keyFn: (...args: any[]) => K,
  fn: (...args: any[]) => Promise<V> | V
): (...args: any[]) => Promise<V> | V {
  return async (...args: any[]) => {
    const key = keyFn(...args);
    const cached = cache.get(key);
    
    if (cached !== undefined) {
      return cached;
    }
    
    const result = await fn(...args);
    cache.set(key, result);
    return result;
  };
}

/**
 * Wrap a function with caching and TTL
 * @param cache - The cache instance to use
 * @param keyFn - Function to generate cache key from arguments
 * @param fn - The function to cache
 * @param ttlMs - Custom TTL for this specific cache
 */
export function withCustomCache<K extends string | number, V>(
  cache: LRUCache<K, V>,
  keyFn: (...args: any[]) => K,
  fn: (...args: any[]) => Promise<V> | V,
  ttlMs: number
): (...args: any[]) => Promise<V> | V {
  return async (...args: any[]) => {
    const key = keyFn(...args);
    const cached = cache.get(key);
    
    if (cached !== undefined) {
      return cached;
    }
    
    const result = await fn(...args);
    
    // Create a temporary cache entry with custom TTL
    cache.set(key, result);
    
    // Schedule cleanup after TTL
    setTimeout(() => {
      cache.delete(key);
    }, ttlMs);
    
    return result;
  };
}

// =============================================================================
// CACHE STATISTICS
// =============================================================================

let cacheHits = 0;
let cacheMisses = 0;

/**
 * Increment cache hit counter
 */
export function incrementCacheHits() {
  cacheHits++;
}

/**
 * Increment cache miss counter
 */
export function incrementCacheMisses() {
  cacheMisses++;
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  const total = cacheHits + cacheMisses;
  const hitRate = total > 0 ? (cacheHits / total) * 100 : 0;
  
  return {
    hits: cacheHits,
    misses: cacheMisses,
    total,
    hitRate: `${hitRate.toFixed(2)}%`,
  };
}

/**
 * Reset cache statistics
 */
export function resetCacheStats() {
  cacheHits = 0;
  cacheMisses = 0;
}
