/**
 * Error Notification Service
 *
 * Sends notifications for critical application errors via multiple channels
 * (Discord webhooks, email, logging) to ensure failures are not silent.
 */

import axios, { AxiosResponse } from "axios";
import logger from "./logger";
import { getCurrentContext, getContextForLogging } from "../utils/context";

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

    constructor() {
        this.enabled = !!process.env.DISCORD_WEBHOOK_URL;
    }

    async send(notification: ErrorNotification): Promise<boolean> {
        if (!this.enabled || !process.env.DISCORD_WEBHOOK_URL) return false;

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

            const response: AxiosResponse = await axios.post(
                process.env.DISCORD_WEBHOOK_URL,
                payload,
                {
                    headers: { "Content-Type": "application/json" },
                    timeout: 5000,
                }
            );

            return response.status === 204;
        } catch (error) {
            logger.error("Failed to send Discord notification", {
                error: (error as Error).message,
                severity: notification.severity,
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
 * Error Notification Service
 */
export class ErrorNotificationService {
    private channels: NotificationChannel[] = [];
    private errorCounts = new Map<string, { count: number; lastNotification: number }>();
    private readonly NOTIFICATION_COOLDOWN = 5 * 60 * 1000; // 5 minutes between similar errors

    constructor() {
        // Initialize notification channels
        this.channels.push(new DiscordWebhookChannel());
        this.channels.push(new EmailChannel());
        this.channels.push(new LogChannel());

        logger.info("Error notification service initialized", {
            channels: this.channels.map(c => ({ name: c.name, enabled: c.enabled })),
        });
    }

    /**
     * Send error notification through all enabled channels
     */
    async notify(notification: ErrorNotification): Promise<void> {
        // Check if we should throttle this notification
        if (this.shouldThrottleNotification(notification)) {
            logger.debug("Error notification throttled", {
                category: notification.context.category,
                operation: notification.context.operation,
            });
            return;
        }

        const enabledChannels = this.channels.filter(c => c.enabled);

        if (enabledChannels.length === 0) {
            logger.warn("No notification channels enabled", { severity: notification.severity });
            return;
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
        }

        // Update throttling counters
        this.updateThrottleCounters(notification);
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

        await this.notify(notification);
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
     * Reset throttling counters (useful for testing)
     */
    resetThrottleCounters(): void {
        this.errorCounts.clear();
    }
}

// Export singleton instance
export const errorNotificationService = new ErrorNotificationService();
