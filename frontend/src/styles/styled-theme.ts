/** @format */

import { DefaultTheme } from 'styled-components';

// CSS-in-JS Theme Interface
export interface StyledTheme extends DefaultTheme {
    colors: {
        primary: string;
        primaryHover: string;
        secondary: string;
        secondaryHover: string;
        accent: string;
        danger: string;
        warning: string;
        info: string;
        success: string;

        background: {
            primary: string;
            surface: string;
            surfaceLight: string;
            glass: string;
            glassHover: string;
            input: string;
            inputFocus: string;
            tableHeader: string;
            tooltip: string;
        };

        text: {
            primary: string;
            secondary: string;
            tertiary: string;
        };

        border: {
            light: string;
            medium: string;
        };

        shadow: {
            glow: string;
            lg: string;
        };
    };

    spacing: {
        xs: string;
        sm: string;
        md: string;
        lg: string;
        xl: string;
    };

    borderRadius: {
        sm: string;
        md: string;
        lg: string;
        xl: string;
    };

    fontSize: {
        xs: string;
        sm: string;
        base: string;
        lg: string;
        xl: string;
        '2xl': string;
        '3xl': string;
        '4xl': string;
    };

    breakpoints: {
        sm: string;
        md: string;
        lg: string;
        xl: string;
        '2xl': string;
        '3xl': string;
        '4xl': string;
    };
}

// Light Theme
export const lightTheme: StyledTheme = {
    colors: {
        primary: '#3b82f6',
        primaryHover: '#2563eb',
        secondary: '#10b981',
        secondaryHover: '#059669',
        accent: '#8b5cf6',
        danger: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6',
        success: '#10b981',

        background: {
            primary: '#ffffff',
            surface: '#f8fafc',
            surfaceLight: '#f1f5f9',
            glass: 'rgba(248, 250, 252, 0.8)',
            glassHover: 'rgba(241, 245, 249, 0.9)',
            input: 'rgba(241, 245, 249, 0.7)',
            inputFocus: 'rgba(241, 245, 249, 0.9)',
            tableHeader: 'rgba(241, 245, 249, 0.8)',
            tooltip: 'rgba(248, 250, 252, 0.95)',
        },

        text: {
            primary: '#1e293b',
            secondary: '#64748b',
            tertiary: '#94a3b8',
        },

        border: {
            light: 'rgba(0, 0, 0, 0.08)',
            medium: 'rgba(0, 0, 0, 0.12)',
        },

        shadow: {
            glow: '0 0 20px rgba(59, 130, 246, 0.1)',
            lg: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
        },
    },

    spacing: {
        xs: '0.25rem',
        sm: '0.5rem',
        md: '1rem',
        lg: '1.5rem',
        xl: '2rem',
    },

    borderRadius: {
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
    },

    fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
    },

    breakpoints: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1536px',
        '3xl': '1920px',
        '4xl': '2560px',
    },
};

// Dark Theme (Default)
export const darkTheme: StyledTheme = {
    colors: {
        primary: '#6366f1',
        primaryHover: '#818cf8',
        secondary: '#10b981',
        secondaryHover: '#34d399',
        accent: '#8b5cf6',
        danger: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6',
        success: '#10b981',

        background: {
            primary: '#0a0a0f',
            surface: '#13131a',
            surfaceLight: '#1a1a24',
            glass: 'rgba(30, 30, 46, 0.8)',
            glassHover: 'rgba(19, 19, 26, 0.9)',
            input: 'rgba(19, 19, 26, 0.7)',
            inputFocus: 'rgba(19, 19, 26, 0.9)',
            tableHeader: 'rgba(19, 19, 26, 0.8)',
            tooltip: 'rgba(30, 30, 46, 0.95)',
        },

        text: {
            primary: '#f8fafc',
            secondary: '#94a3b8',
            tertiary: '#64748b',
        },

        border: {
            light: 'rgba(255, 255, 255, 0.08)',
            medium: 'rgba(255, 255, 255, 0.12)',
        },

        shadow: {
            glow: '0 0 20px rgba(99, 102, 241, 0.1)',
            lg: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
        },
    },

    spacing: {
        xs: '0.25rem',
        sm: '0.5rem',
        md: '1rem',
        lg: '1.5rem',
        xl: '2rem',
    },

    borderRadius: {
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
    },

    fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
    },

    breakpoints: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1536px',
        '3xl': '1920px',
        '4xl': '2560px',
    },
};

// Helper function to get theme from CSS variables
export const getThemeFromCSS = (): StyledTheme => {
    const computedStyle = getComputedStyle(document.documentElement);

    return {
        colors: {
            primary: computedStyle.getPropertyValue('--primary') || darkTheme.colors.primary,
            primaryHover: computedStyle.getPropertyValue('--primary-hover') || darkTheme.colors.primaryHover,
            secondary: computedStyle.getPropertyValue('--secondary') || darkTheme.colors.secondary,
            secondaryHover: computedStyle.getPropertyValue('--secondary-hover') || darkTheme.colors.secondaryHover,
            accent: computedStyle.getPropertyValue('--accent') || darkTheme.colors.accent,
            danger: computedStyle.getPropertyValue('--danger') || darkTheme.colors.danger,
            warning: computedStyle.getPropertyValue('--warning') || darkTheme.colors.warning,
            info: computedStyle.getPropertyValue('--info') || darkTheme.colors.info,
            success: darkTheme.colors.success,

            background: {
                primary: computedStyle.getPropertyValue('--bg-primary') || darkTheme.colors.background.primary,
                surface: computedStyle.getPropertyValue('--bg-surface') || darkTheme.colors.background.surface,
                surfaceLight: computedStyle.getPropertyValue('--bg-surface-light') || darkTheme.colors.background.surfaceLight,
                glass: computedStyle.getPropertyValue('--bg-glass') || darkTheme.colors.background.glass,
                glassHover: computedStyle.getPropertyValue('--bg-glass-hover') || darkTheme.colors.background.glassHover,
                input: computedStyle.getPropertyValue('--bg-input') || darkTheme.colors.background.input,
                inputFocus: computedStyle.getPropertyValue('--bg-input-focus') || darkTheme.colors.background.inputFocus,
                tableHeader: computedStyle.getPropertyValue('--bg-table-header') || darkTheme.colors.background.tableHeader,
                tooltip: computedStyle.getPropertyValue('--bg-tooltip') || darkTheme.colors.background.tooltip,
            },

            text: {
                primary: computedStyle.getPropertyValue('--text-primary') || darkTheme.colors.text.primary,
                secondary: computedStyle.getPropertyValue('--text-secondary') || darkTheme.colors.text.secondary,
                tertiary: computedStyle.getPropertyValue('--text-tertiary') || darkTheme.colors.text.tertiary,
            },

            border: {
                light: computedStyle.getPropertyValue('--border-light') || darkTheme.colors.border.light,
                medium: computedStyle.getPropertyValue('--border-medium') || darkTheme.colors.border.medium,
            },

            shadow: {
                glow: computedStyle.getPropertyValue('--shadow-glow') || darkTheme.colors.shadow.glow,
                lg: computedStyle.getPropertyValue('--shadow-lg') || darkTheme.colors.shadow.lg,
            },
        },

        spacing: darkTheme.spacing,
        borderRadius: darkTheme.borderRadius,
        fontSize: darkTheme.fontSize,
        breakpoints: darkTheme.breakpoints,
    };
};

export default darkTheme;
