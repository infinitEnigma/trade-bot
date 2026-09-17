/**
 * Token-refresh Redis mutex — extracted from `auth.middleware.ts`.
 *
 * Owns the `mutex:refresh:<userId>` acquire/release dance (SET NX + 30s TTL,
 * owner-token compare-and-delete via Lua) so the middleware never touches
 * `redisService.getClient()` directly for locking.
 */

import { randomBytes } from "crypto";
import { redisService } from "../../infrastructure/cache/redis.service";
import { authLogger } from "../../core/logging";

// Atomic mutex release: only the owner may delete the key. Prevents releasing
// a lock that has expired and already been re-acquired by another request.
export const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export interface RefreshMutex {
    /** Redis key, or null when no userId could be decoded from the token. */
    key: string | null;
    /** True when this holder owns the lock and must release it. */
    acquired: boolean;
}

/** Acquire `mutex:refresh:<userId>` (fail-open: proceeds unlocked on error). */
export const acquireRefreshMutex = async (userId: string | undefined): Promise<RefreshMutex & { token: string }> => {
    const mutex = { key: userId ? `mutex:refresh:${userId}` : null, acquired: false };
    // Random owner token so only this request can release its own lock
    const token = randomBytes(16).toString("hex");
    if (mutex.key) {
        try {
            // Use SETNX (set if not exists) with short TTL for mutex
            const lockResult = await redisService.getClient().set(mutex.key, token, {
                NX: true,
                EX: 30, // 30 second lock
            });
            mutex.acquired = lockResult === "OK";
            if (!mutex.acquired) {
                authLogger.debug("Token refresh mutex already held, queuing request", {
                    userId,
                    mutexKey: mutex.key,
                });
            }
        } catch (lockError) {
            authLogger.warn("Failed to acquire token refresh mutex", {
                error: lockError instanceof Error ? lockError.message : String(lockError),
                userId,
                mutexKey: mutex.key,
            });
            // Continue without mutex - better to allow refresh than block
        }
    }
    return { ...mutex, token };
};

/** Release a previously acquired mutex (owner-token compare-and-delete). */
export const releaseRefreshMutex = async (
    mutex: RefreshMutex & { token: string },
    userId: string | undefined,
): Promise<void> => {
    if (!mutex.acquired || !mutex.key) {
        return;
    }
    try {
        // Atomic compare-and-delete: only release the lock we still own
        await redisService.getClient().eval(RELEASE_LOCK_SCRIPT, {
            keys: [mutex.key],
            arguments: [mutex.token],
        });
        authLogger.debug("Released token refresh mutex", {
            userId,
            mutexKey: mutex.key,
        });
    } catch (unlockError) {
        authLogger.warn("Failed to release token refresh mutex", {
            error: unlockError instanceof Error ? unlockError.message : String(unlockError),
            userId,
            mutexKey: mutex.key,
        });
    }
};
