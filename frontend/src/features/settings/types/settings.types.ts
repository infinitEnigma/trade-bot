/** @format */

export interface KodiakCredentials {
    accountId: string;
    apiKey: string;
    secretKey: string;
}

export interface KodiakStatus {
    connected: boolean;
    accountId?: string;
    connectedAt?: string;
    verified?: boolean;
    userLevel?: string;
}

export interface AccountOverview {
    userLevel: string;
    accountStatus: string;
    kodiakConnected: boolean;
    lastSync?: string;
}

export interface ProfileFormData {
    email: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
}

export interface ProfileUpdatePayload {
    email?: string;
    currentPassword?: string;
    newPassword?: string;
}

export interface SettingsState {
    kodiakStatus: KodiakStatus | null;
    accountOverview: AccountOverview;
    isLoading: boolean;
    error: string | null;
}

/**
 * Form validation state interface
 */
export interface ValidationState {
    fieldErrors?: Record<string, string>;
    formError?: string;
    isValid?: boolean;
    touched?: Record<string, boolean>;
}

export interface ProfileState {
    isEditing: boolean;
    isSaving: boolean;
    formData: ProfileFormData;
    validation: ValidationState;
}

export interface SettingsActions {
    connectKodiak: (credentials: KodiakCredentials) => Promise<void>;
    disconnectKodiak: () => Promise<void>;
    refreshStatus: () => Promise<void>;
}

export interface ProfileActions {
    updateProfile: (data: ProfileUpdatePayload) => Promise<void>;
    startEditing: () => void;
    cancelEditing: () => void;
    updateFormData: (data: Partial<ProfileFormData>) => void;
}
