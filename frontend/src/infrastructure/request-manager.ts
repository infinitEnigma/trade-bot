/** @format */

/**
 * Global Request Deduplication Manager
 *
 * Prevents duplicate API requests across all API clients in the application.
 * Works as a singleton that coordinates requests globally.
 */

interface PendingRequest {
    promise: Promise<any>;
    timestamp: number;
    clientId: string;
}

class GlobalRequestManager {
    private static instance: GlobalRequestManager;
    private pendingRequests = new Map<string, PendingRequest>();
    private requestTimeout = 30000; // 30 seconds

    private constructor() { }

    static getInstance(): GlobalRequestManager {
        if (!GlobalRequestManager.instance) {
            GlobalRequestManager.instance = new GlobalRequestManager();
        }
        return GlobalRequestManager.instance;
    }

    /**
     * Deduplicate a request globally
     * Returns existing promise if same request is pending
     */
    async deduplicateRequest<T>(
        key: string,
        requestFn: () => Promise<T>,
        clientId: string = 'unknown'
    ): Promise<T> {
        const existing = this.pendingRequests.get(key);

        if (existing && (Date.now() - existing.timestamp) < this.requestTimeout) {
            console.log(`🔄 Global deduplication: reusing request for ${key} from ${existing.clientId}`);
            return existing.promise;
        }

        // Clean up expired requests
        if (existing) {
            this.pendingRequests.delete(key);
        }

        const promise = this.executeRequest(key, requestFn, clientId);
        this.pendingRequests.set(key, {
            promise,
            timestamp: Date.now(),
            clientId
        });

        return promise;
    }

    private async executeRequest<T>(
        key: string,
        requestFn: () => Promise<T>,
        clientId: string
    ): Promise<T> {
        try {
            console.log(`🚀 Executing request: ${key} from ${clientId}`);
            const result = await requestFn();
            console.log(`✅ Request completed: ${key}`);
            return result;
        } finally {
            // Clean up after request completes (success or failure)
            this.pendingRequests.delete(key);
        }
    }

    /**
     * Get statistics about pending requests
     */
    getStats(): { pendingCount: number; keys: string[] } {
        return {
            pendingCount: this.pendingRequests.size,
            keys: Array.from(this.pendingRequests.keys())
        };
    }

    /**
     * Clear all pending requests (useful for testing or forced cleanup)
     */
    clearAll(): void {
        console.log(`🧹 Clearing ${this.pendingRequests.size} pending requests`);
        this.pendingRequests.clear();
    }
}

// Export singleton instance
export const globalRequestManager = GlobalRequestManager.getInstance();