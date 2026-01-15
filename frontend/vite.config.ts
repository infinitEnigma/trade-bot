/** @format */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Core React libraries (must be first to avoid circular deps)
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') ||
              id.includes('node_modules/scheduler') || id.includes('node_modules/use-sync-external-store')) {
            return 'vendor';
          }

          // React ecosystem
          if (id.includes('node_modules/react-router-dom')) {
            return 'router';
          }
          if (id.includes('node_modules/@tanstack/react-query') ||
              id.includes('node_modules/@tanstack/query-core')) {
            return 'query';
          }

          // Web3 libraries (keep separate from query to avoid circular deps)
          if (id.includes('node_modules/wagmi') || id.includes('node_modules/@wagmi')) {
            return 'wagmi';
          }
          if (id.includes('node_modules/ethers') || id.includes('node_modules/viem') ||
              id.includes('node_modules/@noble') || id.includes('node_modules/ox')) {
            return 'web3-core';
          }

          // Chart libraries
          if (id.includes('node_modules/lightweight-charts') || id.includes('node_modules/fancy-canvas')) {
            return 'charts-lightweight';
          }
          if (id.includes('node_modules/recharts') || id.includes('node_modules/victory-vendor') ||
              id.includes('node_modules/d3-')) {
            return 'charts-recharts';
          }

          // UI libraries
          if (id.includes('node_modules/@radix-ui') || id.includes('node_modules/framer-motion') ||
              id.includes('node_modules/motion-')) {
            return 'ui';
          }

          // Utilities and smaller libraries
          if (id.includes('node_modules/axios') || id.includes('node_modules/socket.io') ||
              id.includes('node_modules/engine.io') || id.includes('node_modules/date-fns') ||
              id.includes('node_modules/zod') || id.includes('node_modules/sonner') ||
              id.includes('node_modules/lucide-react') || id.includes('node_modules/class-variance-authority') ||
              id.includes('node_modules/clsx') || id.includes('node_modules/tailwind-merge')) {
            return 'utils';
          }

          // State management (keep separate from React to avoid circular deps)
          if (id.includes('node_modules/zustand') || id.includes('node_modules/redux')) {
            return 'state';
          }

          // Form handling
          if (id.includes('node_modules/react-hook-form') || id.includes('node_modules/@hookform')) {
            return 'forms';
          }

          // Catch-all for any remaining node_modules (keep minimal)
          if (id.includes('node_modules')) {
            return 'vendor-misc';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600, // Lower warning limit now that chunks are smaller
  },
  server: {
    host: true, // Allow access from local network
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
});
