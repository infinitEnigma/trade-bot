/**
 * ===========================================
 * 👤 USER DOMAIN - User Management
 * ===========================================
 *
 * Core business logic for user profile management,
 * user-specific integrations, and user data operations.
 *
 * RESPONSIBILITIES:
 * - User profile management and updates
 * - User-specific API integrations (Kodiak)
 * - User preferences and settings
 * - User data validation and processing
 *
 * @format
 */

// Export user-related services
export { UserProfileService } from './user-profile.service';
export { UserKodiakService } from './user-kodiak.service';

// Export types
export type { UserProfile, UserSettings } from './user-profile.service';
export type { KodiakUserConfig, KodiakCredentials } from './user-kodiak.service';
