/**
 * ===========================================
 * 📢 NOTIFICATIONS DOMAIN - System Notifications
 * ===========================================
 *
 * Core business logic for error notifications, system alerts,
 * and user communication services.
 *
 * RESPONSIBILITIES:
 * - Error notification management and delivery
 * - System health monitoring alerts
 * - User notification preferences
 * - Alert escalation and routing
 *
 * @format
 */

// Export notification-related services
export { errorNotificationService } from './error-notification.service';

// Export types
export type { NotificationConfig, ErrorAlert } from './error-notification.service';
export type { NotificationSeverity, NotificationChannelType } from './error-notification.service';
