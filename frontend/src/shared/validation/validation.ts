/** @format */

// ============================================
// Validation Utilities
// ============================================

export interface ValidationResult {
    isValid: boolean;
    message: string;
}

export interface FieldValidation extends ValidationResult {
    touched: boolean;
}

export interface PasswordStrength {
    score: number;
    strength: 'weak' | 'medium' | 'strong';
    checks: {
        length: boolean;
        uppercase: boolean;
        lowercase: boolean;
        number: boolean;
        special: boolean;
    };
}

// ============================================
// Email Validation
// ============================================

export const validateEmail = (email: string): ValidationResult => {
    const trimmed = email.trim();

    if (!trimmed) {
        return { isValid: false, message: 'Email address is required' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
        return { isValid: false, message: 'Please enter a valid email address' };
    }

    return { isValid: true, message: '' };
};

export const validateEmailChange = (newEmail: string, originalEmail: string): ValidationResult => {
    const emailValidation = validateEmail(newEmail);
    if (!emailValidation.isValid) {
        return emailValidation;
    }

    if (newEmail.toLowerCase() === originalEmail.toLowerCase()) {
        return { isValid: false, message: 'Email address has not changed' };
    }

    return { isValid: true, message: '' };
};

// ============================================
// Password Validation
// ============================================

export const validatePasswordStrength = (password: string): PasswordStrength => {
    const checks = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /\d/.test(password),
        special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    };

    const passedChecks = Object.values(checks).filter(Boolean).length;
    let strength: 'weak' | 'medium' | 'strong';
    let score: number;

    if (passedChecks < 3) {
        strength = 'weak';
        score = 33;
    } else if (passedChecks < 5) {
        strength = 'medium';
        score = 66;
    } else {
        strength = 'strong';
        score = 100;
    }

    return { score, strength, checks };
};

export const validatePasswordRequirements = (password: string): ValidationResult => {
    const strength = validatePasswordStrength(password);

    if (!strength.checks.length) {
        return { isValid: false, message: 'Password must be at least 8 characters long' };
    }

    if (!strength.checks.uppercase) {
        return { isValid: false, message: 'Password must contain at least one uppercase letter' };
    }

    if (!strength.checks.lowercase) {
        return { isValid: false, message: 'Password must contain at least one lowercase letter' };
    }

    if (!strength.checks.number) {
        return { isValid: false, message: 'Password must contain at least one number' };
    }

    if (!strength.checks.special) {
        return { isValid: false, message: 'Password must contain at least one special character' };
    }

    return { isValid: true, message: '' };
};

export const validateCurrentPassword = (password: string): ValidationResult => {
    if (!password.trim()) {
        return { isValid: false, message: 'Current password is required' };
    }

    return { isValid: true, message: '' };
};

export const validatePasswordConfirmation = (password: string, confirmPassword: string): ValidationResult => {
    if (password !== confirmPassword) {
        return { isValid: false, message: 'Passwords do not match' };
    }

    return { isValid: true, message: '' };
};

export const validatePasswordChange = (
    currentPassword: string,
    newPassword: string,
    confirmPassword: string
): ValidationResult => {
    // Validate current password
    const currentValidation = validateCurrentPassword(currentPassword);
    if (!currentValidation.isValid) {
        return currentValidation;
    }

    // Validate new password requirements
    const newPasswordValidation = validatePasswordRequirements(newPassword);
    if (!newPasswordValidation.isValid) {
        return { isValid: false, message: newPasswordValidation.message };
    }

    // Validate password confirmation
    const confirmationValidation = validatePasswordConfirmation(newPassword, confirmPassword);
    if (!confirmationValidation.isValid) {
        return confirmationValidation;
    }

    // Check if new password is different from current
    if (newPassword === currentPassword) {
        return { isValid: false, message: 'New password must be different from current password' };
    }

    return { isValid: true, message: '' };
};

// ============================================
// Form Validation State Management
// ============================================

export interface ProfileValidationState {
    email: FieldValidation;
    currentPassword: FieldValidation;
    newPassword: FieldValidation & { strength: PasswordStrength };
    confirmPassword: FieldValidation;
    form: {
        isValid: boolean;
        isDirty: boolean;
        hasEmailChanges: boolean;
        hasPasswordChanges: boolean;
    };
}

export const createInitialValidationState = (): ProfileValidationState => ({
    email: { isValid: true, message: '', touched: false },
    currentPassword: { isValid: true, message: '', touched: false },
    newPassword: {
        isValid: true,
        message: '',
        touched: false,
        strength: {
            score: 0, strength: 'weak', checks: {
                length: false, uppercase: false, lowercase: false, number: false, special: false
            }
        }
    },
    confirmPassword: { isValid: true, message: '', touched: false },
    form: {
        isValid: true,
        isDirty: false,
        hasEmailChanges: false,
        hasPasswordChanges: false,
    },
});

export const validateProfileForm = (
    formData: {
        email: string;
        currentPassword: string;
        newPassword: string;
        confirmPassword: string;
    },
    originalEmail: string,
    isEditing: boolean
): ProfileValidationState => {
    const validation = createInitialValidationState();

    // Email validation (only if editing)
    if (isEditing) {
        const emailValidation = validateEmailChange(formData.email, originalEmail);
        validation.email = {
            ...emailValidation,
            touched: formData.email !== originalEmail,
        };
    }

    // Password validation (only if changing password)
    const hasPasswordChanges = formData.currentPassword || formData.newPassword || formData.confirmPassword;

    if (hasPasswordChanges) {
        // Current password validation
        const currentValidation = validateCurrentPassword(formData.currentPassword);
        validation.currentPassword = {
            ...currentValidation,
            touched: Boolean(formData.currentPassword),
        };

        // New password validation and strength
        const passwordValidation = validatePasswordRequirements(formData.newPassword);
        const strength = validatePasswordStrength(formData.newPassword);
        validation.newPassword = {
            ...passwordValidation,
            touched: Boolean(formData.newPassword),
            strength,
        };

        // Confirm password validation
        const confirmValidation = validatePasswordConfirmation(formData.newPassword, formData.confirmPassword);
        validation.confirmPassword = {
            ...confirmValidation,
            touched: Boolean(formData.confirmPassword),
        };

        // Overall password change validation
        if (formData.newPassword && formData.confirmPassword) {
            const overallValidation = validatePasswordChange(
                formData.currentPassword,
                formData.newPassword,
                formData.confirmPassword
            );

            // Override individual validations with overall result if all fields are filled
            if (formData.currentPassword && formData.newPassword && formData.confirmPassword) {
                if (!overallValidation.isValid) {
                    // Find which field should show the error
                    if (overallValidation.message.includes('Current password')) {
                        validation.currentPassword = { ...validation.currentPassword, ...overallValidation };
                    } else if (overallValidation.message.includes('must be different')) {
                        validation.newPassword = { ...validation.newPassword, ...overallValidation };
                    } else if (overallValidation.message.includes('do not match')) {
                        validation.confirmPassword = { ...validation.confirmPassword, ...overallValidation };
                    } else {
                        validation.newPassword = { ...validation.newPassword, ...overallValidation };
                    }
                }
            }
        }
    }

    // Form-level validation
    validation.form = {
        isValid: validation.email.isValid && validation.currentPassword.isValid &&
            validation.newPassword.isValid && validation.confirmPassword.isValid,
        isDirty: Boolean(formData.email !== originalEmail || hasPasswordChanges),
        hasEmailChanges: Boolean(formData.email !== originalEmail && validation.email.isValid),
        hasPasswordChanges: Boolean(hasPasswordChanges && validation.currentPassword.isValid &&
            validation.newPassword.isValid && validation.confirmPassword.isValid),
    };

    return validation;
};

// ============================================
// Utility Functions
// ============================================

export const getPasswordStrengthColor = (strength: 'weak' | 'medium' | 'strong'): string => {
    switch (strength) {
        case 'weak': return 'text-red-400 bg-red-500';
        case 'medium': return 'text-yellow-400 bg-yellow-500';
        case 'strong': return 'text-green-400 bg-green-500';
    }
};

export const getPasswordStrengthText = (strength: 'weak' | 'medium' | 'strong'): string => {
    switch (strength) {
        case 'weak': return 'Weak';
        case 'medium': return 'Medium';
        case 'strong': return 'Strong';
    }
};
