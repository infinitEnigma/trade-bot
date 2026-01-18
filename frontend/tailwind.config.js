/** @format */

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    },
    extend: {
      colors: {
        // Using CSS variables for consistency
        background: 'var(--bg-primary)',
        surface: 'var(--bg-surface)',
        surfaceLight: 'var(--bg-surface-light)',
        primary: 'var(--primary)',
        primaryHover: 'var(--primary-hover)',
        secondary: 'var(--secondary)',
        secondaryHover: 'var(--secondary-hover)',
        accent: 'var(--accent)',
        success: 'var(--secondary)', // alias for consistency
        danger: 'var(--danger)',
        warning: 'var(--warning)',
        info: 'var(--info)',
        text: 'var(--text-primary)',
        textMuted: 'var(--text-secondary)',
        textTertiary: 'var(--text-tertiary)',
        border: 'var(--border-light)',
      },
      spacing: {
        xs: 'var(--spacing-xs)',
        sm: 'var(--spacing-sm)',
        md: 'var(--spacing-md)',
        lg: 'var(--spacing-lg)',
        xl: 'var(--spacing-xl)',
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
};
