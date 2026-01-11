/** @format */

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Using Tailwind's standard color palette
        background: "#0a0a0f",
        surface: "#1f2937", // gray-800
        surfaceLight: "#374151", // gray-700
        primary: "#6366f1", // indigo-500
        primaryHover: "#4f46e5", // indigo-600
        success: "#10b981", // emerald-500
        danger: "#ef4444", // red-500
        warning: "#f59e0b", // amber-500
        text: "#f9fafb", // gray-50
        textMuted: "#9ca3af", // gray-400
        border: "#374151", // gray-700
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
};
