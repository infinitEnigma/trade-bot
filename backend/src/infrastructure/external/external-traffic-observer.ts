/**
 * External Traffic Observer
 *
 * Minimal, non-breaking observability for privileged-user and Kodiak traffic.
 * This only records counters and emits structured debug/info logs. It does not
 * alter request/response behavior or downstream return values.
 *
 * @format
 */

export interface ExternalTrafficSnapshot {
  kodiakRequests: number;
  kodiakCacheHits: number;
  kodiakCacheMisses: number;
  kodiakErrors: number;
  kodiak429: number;
  privilegedConnections: number;
}

interface TaggedCounter {
  count: number;
  lastSeenAt: number;
}

const MAX_TAGGED_KEYS = 500;

export class ExternalTrafficObserver {
  private kodiakRequests = 0;
  private kodiakCacheHits = 0;
  private kodiakCacheMisses = 0;
  private kodiakErrors = 0;
  private kodiak429 = 0;
  private privilegedConnections = 0;
  private readonly tagged = new Map<string, TaggedCounter>();

  recordKodiakRequest(operation: string, userId = "unknown"): void {
    this.kodiakRequests += 1;
    this.bumpTag(`kodiak:${operation}:${userId}`);
  }

  recordKodiakCacheHit(operation: string, userId = "unknown"): void {
    this.kodiakCacheHits += 1;
    this.bumpTag(`kodiak-cache-hit:${operation}:${userId}`);
  }

  recordKodiakCacheMiss(operation: string, userId = "unknown"): void {
    this.kodiakCacheMisses += 1;
    this.bumpTag(`kodiak-cache-miss:${operation}:${userId}`);
  }

  recordKodiakError(operation: string, status?: number): void {
    this.kodiakErrors += 1;
    if (status === 429) this.kodiak429 += 1;
    this.bumpTag(`kodiak-error:${operation}:${status ?? "unknown"}`);
  }

  recordPrivilegedConnection(
    userId: string,
    userLevel: string,
    socketId: string
  ): void {
    this.privilegedConnections += 1;
    this.bumpTag(`privileged-ws:${userLevel}:${userId}:${socketId}`);
  }

  snapshot(): ExternalTrafficSnapshot {
    return {
      kodiakRequests: this.kodiakRequests,
      kodiakCacheHits: this.kodiakCacheHits,
      kodiakCacheMisses: this.kodiakCacheMisses,
      kodiakErrors: this.kodiakErrors,
      kodiak429: this.kodiak429,
      privilegedConnections: this.privilegedConnections,
    };
  }

  private bumpTag(key: string): void {
    const now = Date.now();
    const current = this.tagged.get(key);
    if (current) {
      current.count += 1;
      current.lastSeenAt = now;
      return;
    }
    if (this.tagged.size >= MAX_TAGGED_KEYS) {
      const oldest = Array.from(this.tagged.entries()).sort(
        (a, b) => a[1].lastSeenAt - b[1].lastSeenAt
      )[0];
      if (oldest) this.tagged.delete(oldest[0]);
    }
    this.tagged.set(key, { count: 1, lastSeenAt: now });
  }
}

export const externalTrafficObserver = new ExternalTrafficObserver();
