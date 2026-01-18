/** @format */

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    screens: {
      sm: '640px',     // Mobile
      md: '768px',     // Tablet
      lg: '1024px',    // Desktop
      xl: '1280px',    // Large Desktop
      '2xl': '1536px', // Ultra-wide
      '3xl': '1920px', // 1080p displays
      '4xl': '2560px', // 1440p displays
    },
    fontSize: {
      'xs': ['0.75rem', { lineHeight: '1rem' }],      // 12px - captions, metadata
      'sm': ['0.875rem', { lineHeight: '1.25rem' }],  // 14px - secondary text, labels
      'base': ['1rem', { lineHeight: '1.5rem' }],     // 16px - body text, default
      'lg': ['1.125rem', { lineHeight: '1.75rem' }],  // 18px - emphasized text, buttons
      'xl': ['1.25rem', { lineHeight: '1.75rem' }],   // 20px - subheadings
      '2xl': ['1.5rem', { lineHeight: '2rem' }],      // 24px - section headers
      '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 30px - page titles
      '4xl': ['2.25rem', { lineHeight: '2.5rem' }],   // 36px - hero titles
      '5xl': ['3rem', { lineHeight: '1' }],           // 48px - large headings
      '6xl': ['3.75rem', { lineHeight: '1' }],        // 60px - hero elements
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
