/** @format */

/**
 * Settings Feature
 *
 * Account settings and configuration management.
 * Handles Kodiak connection and user account preferences.
 */

// Types
export type {
  KodiakCredentials,
  KodiakStatus,
  AccountOverview,
  ProfileFormData,
  ProfileUpdatePayload,
  SettingsState,
  ProfileState,
  SettingsActions,
  ProfileActions,
} from "./types/settings.types";

// Components
export {
  AccountOverview as AccountOverviewCard,
  ConnectExchangeAccount as ConnectExchangeAccountCard,
  ExchangeAccounts as ExchangeAccountsCard,
  ConnectedWallets as ConnectedWalletsCard,
} from "./components";

// Hooks
export { useSettings } from "./hooks";

// Services
export { settingsService } from "./services";
