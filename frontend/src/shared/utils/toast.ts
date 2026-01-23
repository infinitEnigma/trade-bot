/** @format */

import { toast } from "sonner";

export interface ToastOptions {
    duration?: number;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
    id?: string | number;
}

export const SmartToast = {
    // Success toast with enhanced styling
    success: (message: string, options?: ToastOptions) => {
        return toast.success(message, {
            ...options,
            duration: options?.duration || 4000,
            style: {
                background: "#13131a",
                border: "1px solid rgba(34, 197, 94, 0.2)",
                color: "#e2e8f0",
            },
        });
    },

    // Error toast with retry option
    error: (message: string, options?: ToastOptions) => {
        return toast.error(message, {
            ...options,
            duration: options?.duration || 6000,
            action: options?.action || {
                label: "Retry",
                onClick: () => window.location.reload(),
            },
            style: {
                background: "#13131a",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                color: "#e2e8f0",
            },
        });
    },

    // Info toast for general information
    info: (message: string, options?: ToastOptions) => {
        return toast(message, {
            ...options,
            duration: options?.duration || 4000,
            style: {
                background: "#13131a",
                border: "1px solid rgba(59, 130, 246, 0.2)",
                color: "#e2e8f0",
            },
        });
    },

    // Loading toast for operations in progress
    loading: (message: string, options?: ToastOptions) => {
        return toast.loading(message, {
            ...options,
            duration: options?.duration || Infinity,
            style: {
                background: "#13131a",
                border: "1px solid rgba(99, 102, 241, 0.2)",
                color: "#e2e8f0",
            },
        });
    },

    // Progress toast for operations with progress
    progress: (message: string, progress: number, options?: ToastOptions) => {
        const progressBar = "█".repeat(Math.floor(progress / 10)) + "░".repeat(10 - Math.floor(progress / 10));

        return toast.loading(`${message}\n${progressBar} ${progress}%`, {
            ...options,
            duration: Infinity,
            style: {
                background: "#13131a",
                border: "1px solid rgba(99, 102, 241, 0.2)",
                color: "#e2e8f0",
                fontFamily: "monospace",
            },
        });
    },

    // Update existing toast
    update: (id: string | number, message: string, options?: Partial<ToastOptions>) => {
        return toast(message, {
            ...options,
            id,
            style: {
                background: "#13131a",
                border: "1px solid rgba(99, 102, 241, 0.2)",
                color: "#e2e8f0",
            },
        });
    },

    // Dismiss toast
    dismiss: (id?: string | number) => {
        toast.dismiss(id);
    },

    // Dismiss all toasts
    dismissAll: () => {
        toast.dismiss();
    },
};

// Operation-specific toast helpers
export const OperationToasts = {
    // Strategy operations
    strategyCreated: (strategyName: string) =>
        SmartToast.success(`Strategy "${strategyName}" created successfully!`, {
            description: "Your trading strategy is now active",
        }),

    strategyUpdated: (strategyName: string) =>
        SmartToast.success(`Strategy "${strategyName}" updated successfully!`),

    strategyDeleted: (strategyName: string) =>
        SmartToast.success(`Strategy "${strategyName}" deleted successfully!`),

    strategyCreateError: (error: string) =>
        SmartToast.error("Failed to create strategy", {
            description: error,
            action: { label: "Try Again", onClick: () => { } },
        }),

    // Bot operations
    botStarted: (strategyName: string) =>
        SmartToast.success(`🚀 Trading bot started for ${strategyName}!`, {
            description: "Automated trading is now active",
            duration: 5000,
        }),

    botStopped: (strategyName: string) =>
        SmartToast.success(`⏹️ Trading bot stopped for ${strategyName}!`, {
            description: "Automated trading has been halted",
        }),

    botEmergencyStop: (strategyName: string) =>
        SmartToast.success(`🚨 Emergency stop initiated for ${strategyName}!`, {
            description: "All orders will be cancelled",
            duration: 8000,
        }),

    botError: (operation: string, error: string) =>
        SmartToast.error(`Bot ${operation} failed`, {
            description: error,
            action: { label: "Check Status", onClick: () => { } },
        }),

    // Qualification operations
    qualificationSuccess: () =>
        SmartToast.success("🎉 Qualification granted!", {
            description: "You now have access to alpha features",
            duration: 6000,
        }),

    qualificationFailed: (reason: string) =>
        SmartToast.error("Qualification check failed", {
            description: reason,
            action: { label: "Try Again", onClick: () => { } },
        }),

    // Profile operations
    profileUpdated: () =>
        SmartToast.success("Profile updated successfully!", {
            description: "Your changes have been saved",
        }),

    passwordChanged: () =>
        SmartToast.success("Password changed successfully!", {
            description: "Please use your new password for future logins",
        }),

    // Connection operations
    connectionSuccess: (service: string) =>
        SmartToast.success(`${service} connected successfully!`, {
            description: "You can now access all features",
        }),

    connectionError: (service: string, error: string) =>
        SmartToast.error(`Failed to connect to ${service}`, {
            description: error,
            action: { label: "Retry", onClick: () => { } },
        }),

    // Generic operations
    saveSuccess: (item: string) =>
        SmartToast.success(`${item} saved successfully!`),

    deleteSuccess: (item: string) =>
        SmartToast.success(`${item} deleted successfully!`),

    loadError: (item: string, error?: string) =>
        SmartToast.error(`Failed to load ${item}`, {
            description: error || "Please try again",
            action: { label: "Retry", onClick: () => window.location.reload() },
        }),
};

// Progress tracking for long operations
export class OperationProgress {
    private toastId: string | number | undefined;

    start(operation: string, message?: string) {
        this.toastId = SmartToast.loading(message || `${operation} in progress...`);
    }

    update(progress: number, message?: string) {
        if (this.toastId) {
            SmartToast.update(this.toastId, message || `Progress: ${progress}%`, {
                description: "█".repeat(Math.floor(progress / 10)) + "░".repeat(10 - Math.floor(progress / 10)),
            });
        }
    }

    complete(success: boolean, message?: string) {
        if (this.toastId) {
            if (success) {
                SmartToast.update(this.toastId, message || "Operation completed successfully!");
            } else {
                SmartToast.update(this.toastId, message || "Operation failed");
            }
            // Auto dismiss after 4 seconds
            setTimeout(() => SmartToast.dismiss(this.toastId), 4000);
        }
    }

    error(message: string) {
        this.complete(false, message);
    }
}
