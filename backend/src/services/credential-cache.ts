/** @format */

import { encryptionService } from './encryption';
import logger from './logger';

interface CachedCredentials {
  apiKey: string;
  secretKey: string;
  accountId: string;
  cachedAt: number;
  ttl: number; // Time to live in milliseconds
}

class CredentialCacheService {
  private cache = new Map<string, CachedCredentials>();
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get cached decrypted credentials for a user
   * Returns null if not cached or expired
   */
  getCachedCredentials(userId: string): { apiKey: string; secretKey: string; accountId: string } | null {
    const cached = this.cache.get(userId);

    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() - cached.cachedAt > cached.ttl) {
      this.cache.delete(userId);
      logger.debug('Credential cache expired', { userId });
      return null;
    }

    logger.debug('Credential cache hit', { userId });
    return {
      apiKey: cached.apiKey,
      secretKey: cached.secretKey,
      accountId: cached.accountId,
    };
  }

  /**
   * Cache decrypted credentials for a user
   */
  async cacheCredentials(
    userId: string,
    encryptedApiKey: string,
    encryptedSecretKey: string,
    accountId: string,
    ttl: number = this.DEFAULT_TTL
  ): Promise<{ apiKey: string; secretKey: string; accountId: string }> {
    try {
      // Decrypt credentials
      const apiKey = encryptionService.decryptApiKey(encryptedApiKey);
      const secretKey = encryptionService.decryptSecretKey(encryptedSecretKey);

      const credentials: CachedCredentials = {
        apiKey,
        secretKey,
        accountId,
        cachedAt: Date.now(),
        ttl,
      };

      this.cache.set(userId, credentials);

      logger.debug('Credentials cached', {
        userId,
        accountId,
        ttlMinutes: ttl / (60 * 1000),
      });

      return { apiKey, secretKey, accountId };
    } catch (error) {
      logger.error('Failed to cache credentials', {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Get or cache credentials for a user
   * Returns cached credentials if available and valid, otherwise decrypts and caches
   */
  async getOrCacheCredentials(
    userId: string,
    encryptedApiKey: string,
    encryptedSecretKey: string,
    accountId: string,
    ttl: number = this.DEFAULT_TTL
  ): Promise<{ apiKey: string; secretKey: string; accountId: string }> {
    // Try to get from cache first
    const cached = this.getCachedCredentials(userId);
    if (cached) {
      return cached;
    }

    // Not cached or expired, decrypt and cache
    return this.cacheCredentials(userId, encryptedApiKey, encryptedSecretKey, accountId, ttl);
  }

  /**
   * Invalidate cached credentials for a user
   */
  invalidateCredentials(userId: string): void {
    const deleted = this.cache.delete(userId);
    if (deleted) {
      logger.debug('Credentials invalidated', { userId });
    }
  }

  /**
   * Clear all cached credentials (useful for testing or maintenance)
   */
  clearAll(): void {
    const count = this.cache.size;
    this.cache.clear();
    logger.info('All credential caches cleared', { count });
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }

  /**
   * Clean up expired entries (called periodically)
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, cached] of this.cache.entries()) {
      if (now - cached.cachedAt > cached.ttl) {
        this.cache.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Credential cache cleanup completed', { cleaned });
    }
  }
}

// Start cleanup interval (run every 5 minutes)
setInterval(() => {
  credentialCacheService.cleanup();
}, 5 * 60 * 1000);

export const credentialCacheService = new CredentialCacheService();
