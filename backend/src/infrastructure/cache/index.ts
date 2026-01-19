/**
 * ===========================================
 * 💾 CACHE INFRASTRUCTURE - Caching Services
 * ===========================================
 *
 * Infrastructure layer for caching services, Redis operations,
 * and data caching strategies.
 *
 * RESPONSIBILITIES:
 * - Redis connection management
 * - Cache invalidation strategies
 * - Credential caching for performance
 * - Distributed caching coordination
 *
 * @format
 */

// Export cache infrastructure services
export { redisService } from './redis.service';
export { cacheInvalidationService } from './cache-invalidation.service';
export { credentialCacheService } from './credential-cache.service';

// Export Redis sub-services
export * from './redis/index';

// Export types
export type { CacheConfig, CacheEntry } from './redis.service';
export type { InvalidationRule, CacheStrategy } from './cache-invalidation.service';
