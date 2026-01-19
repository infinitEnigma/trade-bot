/**
 * ===========================================
 * 🌐 EXTERNAL INFRASTRUCTURE - External Integrations
 * ===========================================
 *
 * Infrastructure layer for external API integrations,
 * third-party services, and external data sources.
 *
 * RESPONSIBILITIES:
 * - External API connection management
 * - Third-party service integrations
 * - Data synchronization with external systems
 * - API rate limiting and error handling
 *
 * @format
 */

// Export external integration services
export { kodiakConnectionService } from './kodiak-connection.service';
export { kodiakIntegrationService } from './kodiak-integration.service';

// Export external utilities
export * from './kodiak-client';
