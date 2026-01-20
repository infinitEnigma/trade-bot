/**
 * Error Notification Service
 *
 * Sends notifications for critical application errors via multiple channels
 * (Discord webhooks, email, logging) to ensure failures are not silent.
 */

import axios, { AxiosResponse } from "axios";
import { logger } from "../../core/logging";
import { getCurrentContext, getContextForLogging } from "../../shared/utils/context";

export enum ErrorSeverity {
    LOW = "low",           // Minor issues, logged only
    MEDIUM = "medium",     // Warnings, may need attention
    HIGH = "high",         // Critical issues affecting users
    CRITICAL = "critical", // System failures requiring immediate action
}

export enum ErrorCategory {
    NETWORK = "network",
    DATABASE = "database",
    EXTERNAL_API = "external_api",
    BACKGROUND_TASK = "background_task",
    WEBSOCKET = "websocket",
    AUTHENTICATION = "authentication",
    VALIDATION = "validation",
    BUSINESS_LOGIC = "business_logic",
    SYSTEM = "system",
}

export type NotificationSeverity = ErrorSeverity;
export type NotificationChannelType = 'email' | 'websocket' | 'database' | 'slack';

export interface NotificationConfig {
    channels: NotificationChannel[];
    enabled: boolean;
    retryAttempts: number;
    timeout: number;
}

export interface ErrorAlert {
    id: string;
    severity: NotificationSeverity;
    category: ErrorCategory;
    message: string;
    timestamp: Date;
    resolved: boolean;
}

export interface ErrorContext {
    category: ErrorCategory;
    operation: string;
    userId?: string;
    requestId?: string;
    correlationId?: string;
    metadata?: Record<string, any>;
    timestamp: number;
}

export interface ErrorNotification {
    severity: ErrorSeverity;
    message: string;
    context: ErrorContext;
    stackTrace?: string;
    retryCount?: number;
    recoveryAction?: string;
}

/**
 * Error notification channels
 */
interface NotificationChannel {
    name: string;
    enabled: boolean;
    send(notification: ErrorNotification): Promise<boolean>;
}

class DiscordWebhookChannel implements NotificationChannel {
    name = "discord";
    enabled: boolean;

    // Circuit breaker state
    private consecutiveFailures = 0;
    private lastFailureTime = 0;
    private circuitOpen = false;
    private readonly CIRCUIT_BREAKER_THRESHOLD = 3; // Open after 3 failures
    private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute cooldown

    constructor() {
        this.enabled = !!process.env.DISCORD_WEBHOOK_URL;
    }

    async send(notification: ErrorNotification): Promise<boolean> {
        if (!this.enabled || !process.env.DISCORD_WEBHOOK_URL) return false;

        // Check circuit breaker
        if (this.circuitOpen) {
            const timeSinceLastFailure = Date.now() - this.lastFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_TIMEOUT) {
                logger.debug("Discord circuit breaker open, skipping notification", {
                    timeSinceLastFailure,
                    timeout: this.CIRCUIT_BREAKER_TIMEOUT,
                });
                return false; // Circuit is open
            } else {
                // Reset circuit breaker after timeout
                this.circuitOpen = false;
                this.consecutiveFailures = 0;
                logger.info("Discord circuit breaker reset, attempting to send notification");
            }
        }

        try {
            const color = this.getSeverityColor(notification.severity);
            const emoji = this.getSeverityEmoji(notification.severity);

            const embed = {
                title: `${emoji} ${notification.severity.toUpperCase()} Error`,
                description: notification.message,
                color,
                fields: [
                    {
                        name: "Category",
                        value: notification.context.category,
                        inline: true,
                    },
                    {
                        name: "Operation",
                        value: notification.context.operation,
                        inline: true,
                    },
                    {
                        name: "Correlation ID",
                        value: notification.context.correlationId || "N/A",
                        inline: true,
                    },
                    ...(notification.context.userId ? [{
                        name: "User ID",
                        value: notification.context.userId,
                        inline: true,
                    }] : []),
                    ...(notification.retryCount ? [{
                        name: "Retry Count",
                        value: notification.retryCount.toString(),
                        inline: true,
                    }] : []),
                    ...(notification.recoveryAction ? [{
                        name: "Recovery Action",
                        value: notification.recoveryAction,
                        inline: false,
                    }] : []),
                ],
                timestamp: new Date(notification.context.timestamp).toISOString(),
                footer: {
                    text: "Trade Bot Error Notification",
                },
            };

            const payload = {
                embeds: [embed],
                ...(notification.severity === ErrorSeverity.CRITICAL && {
                    content: "@everyone Critical system error detected!",
                }),
            };

            // Reduced timeout from 5s to 3s for better responsiveness
            const response: AxiosResponse = await axios.post(
                process.env.DISCORD_WEBHOOK_URL,
                payload,
                {
                    headers: { "Content-Type": "application/json" },
                    timeout: 3000, // Reduced from 5000ms to prevent blocking
                }
            );

            // Success - reset circuit breaker
            this.consecutiveFailures = 0;
            return response.status === 204;

        } catch (error) {
            // Failure - update circuit breaker state
            this.consecutiveFailures++;
            this.lastFailureTime = Date.now();

            if (this.consecutiveFailures >= this.CIRCUIT_BREAKER_THRESHOLD) {
                this.circuitOpen = true;
                logger.warn("Discord circuit breaker opened due to consecutive failures", {
                    consecutiveFailures: this.consecutiveFailures,
                    threshold: this.CIRCUIT_BREAKER_THRESHOLD,
                });
            }

            logger.error("Failed to send Discord notification", {
                error: (error as Error).message,
                severity: notification.severity,
                consecutiveFailures: this.consecutiveFailures,
                circuitOpen: this.circuitOpen,
            });
            return false;
        }
    }

    private getSeverityColor(severity: ErrorSeverity): number {
        switch (severity) {
            case ErrorSeverity.LOW: return 0x00ff00;      // Green
            case ErrorSeverity.MEDIUM: return 0xffff00;   // Yellow
            case ErrorSeverity.HIGH: return 0xffa500;     // Orange
            case ErrorSeverity.CRITICAL: return 0xff0000; // Red
            default: return 0x808080; // Gray
        }
    }

    private getSeverityEmoji(severity: ErrorSeverity): string {
        switch (severity) {
            case ErrorSeverity.LOW: return "ℹ️";
            case ErrorSeverity.MEDIUM: return "⚠️";
            case ErrorSeverity.HIGH: return "🚨";
            case ErrorSeverity.CRITICAL: return "💥";
            default: return "❓";
        }
    }
}

class EmailChannel implements NotificationChannel {
    name = "email";
    enabled: boolean;

    constructor() {
        // Email notification would require SMTP configuration
        // For now, we'll disable it and implement as needed
        this.enabled = false;
    }

    async send(notification: ErrorNotification): Promise<boolean> {
        // TODO: Implement email notification using nodemailer or similar
        logger.info("Email notification not yet implemented", { severity: notification.severity });
        return false;
    }
}

class LogChannel implements NotificationChannel {
    name = "log";
    enabled = true; // Always enabled

    async send(notification: ErrorNotification): Promise<boolean> {
        const logData = {
            severity: notification.severity,
            category: notification.context.category,
            operation: notification.context.operation,
            message: notification.message,
            ...getContextForLogging(),
            metadata: notification.context.metadata,
            ...(notification.stackTrace && { stackTrace: notification.stackTrace }),
            ...(notification.retryCount && { retryCount: notification.retryCount }),
            ...(notification.recoveryAction && { recoveryAction: notification.recoveryAction }),
        };

        switch (notification.severity) {
            case ErrorSeverity.CRITICAL:
                logger.error("CRITICAL ERROR NOTIFICATION", logData);
                break;
            case ErrorSeverity.HIGH:
                logger.error("HIGH ERROR NOTIFICATION", logData);
                break;
            case ErrorSeverity.MEDIUM:
                logger.warn("MEDIUM ERROR NOTIFICATION", logData);
                break;
            case ErrorSeverity.LOW:
            default:
                logger.info("LOW ERROR NOTIFICATION", logData);
                break;
        }

        return true;
    }
}

/**
 * ===========================================
 * 🚨 ERROR NOTIFICATION SERVICE - FIRE-AND-FORGET
 * ===========================================
 *
 * Asynchronous error notification system that never blocks user requests.
 * Uses background queue processing with circuit breakers and graceful degradation.
 */
export class ErrorNotificationService {
    private channels: NotificationChannel[] = [];
    private errorCounts = new Map<string, { count: number; lastNotification: number }>();
    private readonly NOTIFICATION_COOLDOWN = 5 * 60 * 1000; // 5 minutes between similar errors

    // Fire-and-forget queue system
    private notificationQueue: ErrorNotification[] = [];
    private processing = false;
    private retryInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Initialize notification channels
        this.channels.push(new DiscordWebhookChannel());
        this.channels.push(new EmailChannel());
        this.channels.push(new LogChannel());

        // Start background retry processor
        this.startRetryProcessor();

        logger.info("Error notification service initialized", {
            channels: this.channels.map(c => ({ name: c.name, enabled: c.enabled })),
        });
    }

    /**
     * ===========================================
     * 🚀 FIRE-AND-FORGET NOTIFICATION
     * ===========================================
     *
     * Queues notification for background processing - NEVER blocks user requests.
     * Critical for maintaining application responsiveness during external service failures.
     */
    notify(notification: ErrorNotification): void {
        // Check if we should throttle this notification
        if (this.shouldThrottleNotification(notification)) {
            logger.debug("Error notification throttled", {
                category: notification.context.category,
                operation: notification.context.operation,
            });
            return;
        }

        // Queue for background processing (fire-and-forget)
        this.notificationQueue.push(notification);
        this.processQueueAsync();

        // Update throttling counters immediately
        this.updateThrottleCounters(notification);
    }

    /**
     * Process notification queue asynchronously (background processing)
     */
    private async processQueueAsync(): Promise<void> {
        if (this.processing || this.notificationQueue.length === 0) return;

        this.processing = true;

        try {
            while (this.notificationQueue.length > 0) {
                const notification = this.notificationQueue.shift()!;

                try {
                    await this.sendToChannelsWithRetry(notification);
                } catch (error) {
                    logger.error("Failed to process notification from queue", {
                        error: error instanceof Error ? error.message : String(error),
                        severity: notification.severity,
                        category: notification.context.category,
                    });
                }
            }
        } finally {
            this.processing = false;
        }
    }

    /**
     * Send notification to all channels with retry logic
     */
    private async sendToChannelsWithRetry(notification: ErrorNotification): Promise<boolean> {
        const enabledChannels = this.channels.filter(c => c.enabled);

        if (enabledChannels.length === 0) {
            logger.warn("No notification channels enabled", { severity: notification.severity });
            return false;
        }

        // Send to all enabled channels concurrently
        const results = await Promise.allSettled(
            enabledChannels.map(channel => channel.send(notification))
        );

        const successes = results.filter(r => r.status === 'fulfilled' && r.value).length;
        const failures = results.length - successes;

        if (failures > 0) {
            logger.warn("Some error notifications failed", {
                total: results.length,
                successes,
                failures,
                severity: notification.severity,
            });

            // For critical notifications, persist for retry
            if (notification.severity === ErrorSeverity.CRITICAL) {
                await this.persistFailedNotification(notification);
            }

            // Return true if at least one channel succeeded
            return successes > 0;
        }

        // All channels succeeded
        return true;
    }

    /**
     * Create and send a notification for a caught error
     */
    async notifyError(
        error: Error,
        context: Omit<ErrorContext, 'timestamp'>,
        severity: ErrorSeverity = ErrorSeverity.MEDIUM,
        retryCount?: number,
        recoveryAction?: string
    ): Promise<void> {
        const notification: ErrorNotification = {
            severity,
            message: error.message,
            context: {
                ...context,
                timestamp: Date.now(),
            },
            stackTrace: error.stack,
            retryCount,
            recoveryAction,
        };

        this.notify(notification);
    }

    /**
     * Notify about background task failures
     */
    async notifyBackgroundFailure(
        operation: string,
        error: Error,
        metadata?: Record<string, any>
    ): Promise<void> {
        await this.notifyError(
            error,
            {
                category: ErrorCategory.BACKGROUND_TASK,
                operation,
                metadata: {
                    backgroundTask: true,
                    ...metadata,
                },
                ...this.getCurrentRequestContext(),
            },
            ErrorSeverity.HIGH // Background failures are considered high priority
        );
    }

    /**
     * Notify about WebSocket connection failures
     */
    async notifyWebSocketFailure(
        operation: string,
        error: Error,
        metadata?: Record<string, any>
    ): Promise<void> {
        await this.notifyError(
            error,
            {
                category: ErrorCategory.WEBSOCKET,
                operation,
                metadata: {
                    websocketFailure: true,
                    ...metadata,
                },
                ...this.getCurrentRequestContext(),
            },
            ErrorSeverity.HIGH
        );
    }

    /**
     * Notify about external API failures
     */
    async notifyApiFailure(
        operation: string,
        error: Error,
        metadata?: Record<string, any>
    ): Promise<void> {
        await this.notifyError(
            error,
            {
                category: ErrorCategory.EXTERNAL_API,
                operation,
                metadata: {
                    apiFailure: true,
                    ...metadata,
                },
                ...this.getCurrentRequestContext(),
            },
            ErrorSeverity.MEDIUM
        );
    }

    /**
     * Check if notification should be throttled
     */
    private shouldThrottleNotification(notification: ErrorNotification): boolean {
        // Only throttle LOW and MEDIUM severity notifications
        if (notification.severity === ErrorSeverity.HIGH ||
            notification.severity === ErrorSeverity.CRITICAL) {
            return false;
        }

        const key = `${notification.context.category}:${notification.context.operation}`;
        const existing = this.errorCounts.get(key);

        if (!existing) return false;

        const timeSinceLastNotification = Date.now() - existing.lastNotification;
        return timeSinceLastNotification < this.NOTIFICATION_COOLDOWN;
    }

    /**
     * Update throttling counters
     */
    private updateThrottleCounters(notification: ErrorNotification): void {
        const key = `${notification.context.category}:${notification.context.operation}`;
        const existing = this.errorCounts.get(key);

        this.errorCounts.set(key, {
            count: (existing?.count || 0) + 1,
            lastNotification: Date.now(),
        });
    }

    /**
     * Get current request context for notifications
     */
    private getCurrentRequestContext(): Partial<ErrorContext> {
        const context = getCurrentContext();
        return {
            userId: context?.userId,
            requestId: context?.requestId,
            correlationId: context?.correlationId,
        };
    }

    /**
     * Get notification statistics
     */
    getStats(): {
        channels: { name: string; enabled: boolean }[];
        throttledErrors: number;
        recentErrors: Array<{ key: string; count: number; lastNotification: number }>;
    } {
        return {
            channels: this.channels.map(c => ({ name: c.name, enabled: c.enabled })),
            throttledErrors: Array.from(this.errorCounts.values()).reduce((sum, item) => sum + item.count, 0),
            recentErrors: Array.from(this.errorCounts.entries()).map(([key, data]) => ({
                key,
                count: data.count,
                lastNotification: data.lastNotification,
            })),
        };
    }

    /**
     * Start background retry processor for failed notifications
     */
    private startRetryProcessor(): void {
        if (this.retryInterval) return;

        // Retry failed notifications every 5 minutes
        this.retryInterval = setInterval(async () => {
            await this.retryFailedNotifications();
        }, 5 * 60 * 1000);

        logger.debug("Started notification retry processor");
    }

    /**
     * Retry sending failed notifications
     */
    private async retryFailedNotifications(): Promise<void> {
        try {
            const failedNotifications = await this.getFailedNotifications();

            for (const notification of failedNotifications) {
                try {
                    const success = await this.sendToChannelsWithRetry(notification);
                    if (success) {
                        await this.markNotificationDelivered(notification.id || 'unknown');
                        logger.info("Successfully retried failed notification", {
                            id: notification.id || 'unknown',
                            severity: notification.severity,
                        });
                    }
                } catch (error) {
                    logger.warn("Failed to retry notification", {
                        id: notification.id || 'unknown',
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        } catch (error) {
            logger.error("Error in notification retry processor", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Persist failed critical notification for retry
     */
    private async persistFailedNotification(notification: ErrorNotification): Promise<void> {
        try {
            // For now, just log - in production you'd persist to database
            // This ensures critical notifications aren't completely lost
            logger.warn("Persisting failed critical notification for retry", {
                severity: notification.severity,
                category: notification.context.category,
                operation: notification.context.operation,
                message: notification.message.substring(0, 200), // Truncate for logging
            });

            // TODO: In production, persist to database table:
            // INSERT INTO failed_notifications (data, created_at) VALUES (...)

        } catch (error) {
            logger.error("Failed to persist notification for retry", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Get failed notifications from persistence (stub for production)
     */
    private async getFailedNotifications(): Promise<any[]> {
        // TODO: In production, query database for failed notifications
        // SELECT * FROM failed_notifications WHERE processed = false
        return [];
    }

    /**
     * Mark notification as delivered (stub for production)
     */
    private async markNotificationDelivered(notificationId: string): Promise<void> {
        // TODO: In production, update database record
        // UPDATE failed_notifications SET processed = true WHERE id = ?
        logger.debug("Marked notification as delivered", { notificationId });
    }

    /**
     * Reset throttling counters (useful for testing)
     */
    resetThrottleCounters(): void {
        this.errorCounts.clear();
    }
}

// Export singleton instance
export const errorNotificationService = new ErrorNotificationService();
