/** @format */

import React, { Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Toaster } from "sonner";
import { io } from "socket.io-client";
import { useAuth } from "./features/auth";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ErrorProvider, ErrorNotifications } from "./contexts/ErrorContext";
import { usePageBackground } from "./shared/hooks";
import { websocketSubscriptionManager } from "./infrastructure/websocket/websocket-manager";
import { UserRole } from "../../shared/src";

// Components
import { LoadingSpinner } from "./shared/components/ui";
import { AppHeader } from "./components/ui/AppHeader";
import { getWebSocketUrl } from "./infrastructure/config";

// Lazy load pages
const Login = React.lazy(() => import("./features/auth/pages/Login"));
const Register = React.lazy(() => import("./features/auth/pages/Register"));
const Dashboard = React.lazy(() => import("./features/dashboard/pages/Dashboard"));
const Strategies = React.lazy(() => import("./features/strategies/pages/Strategies"));
const Settings = React.lazy(() => import("./features/settings/pages/Settings"));
const Analytics = React.lazy(() => import("./features/analytics/pages/Analytics"));
const Profile = React.lazy(() => import("./features/auth/pages/Profile"));

// Protected Route Component
const ProtectedRoute = ({
  children,
  requireVerified = false,
  requireRegistered = false,
  requireRole,
}: {
  children: React.ReactNode;
  requireVerified?: boolean;
  requireRegistered?: boolean;
  requireRole?: UserRole;
}) => {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireVerified && user?.userLevel !== "VERIFIED") {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireRegistered && user?.userLevel === "BASIC") {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireRole && !user?.roles?.includes(requireRole)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

// Minimal Providers for Auth Pages (Login/Register)
const MinimalProviders = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider defaultTheme="dark">
    {children}
  </ThemeProvider>
);

// Full Providers for Authenticated App
const FullProviders = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider defaultTheme="dark">
    <ErrorProvider>
      <ConditionalWebSocketInitializer />
      {children}
      <ErrorNotifications />
    </ErrorProvider>
  </ThemeProvider>
);

// Animated Routes Component
const AnimatedRoutes = () => {
  const location = useLocation();

  // Apply page-specific background patterns
  usePageBackground();

  const pageVariants = {
    initial: {
      opacity: 0,
      y: 20,
      scale: 0.98,
    },
    in: {
      opacity: 1,
      y: 0,
      scale: 1,
    },
    out: {
      opacity: 0,
      y: -20,
      scale: 1.02,
    },
  };

  const pageTransition = {
    type: "tween" as const,
    ease: "anticipate" as const,
    duration: 0.4,
  };

  const isAuthRoute = location.pathname === '/login' || location.pathname === '/register';

  return (
    <div className="min-h-screen bg-background text-text">
      {/* Header - only show for protected routes */}
      {!isAuthRoute && <AppHeader />}

      {/* Content area with padding for header */}
      <div className={isAuthRoute ? "" : "pt-16"}>
        <AnimatePresence mode="wait" initial={false}>
          <Routes location={location} key={location.pathname}>
            <Route
              path="/login"
              element={
                <motion.div
                  initial="initial"
                  animate="in"
                  exit="out"
                  variants={pageVariants}
                  transition={pageTransition}
                >
                  <Login />
                </motion.div>
              }
            />
            <Route
              path="/register"
              element={
                <motion.div
                  initial="initial"
                  animate="in"
                  exit="out"
                  variants={pageVariants}
                  transition={pageTransition}
                >
                  <Register />
                </motion.div>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <motion.div
                    initial="initial"
                    animate="in"
                    exit="out"
                    variants={pageVariants}
                    transition={pageTransition}
                  >
                    <Dashboard />
                  </motion.div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/strategies"
              element={
                <ProtectedRoute requireRegistered={true}>
                  <motion.div
                    initial="initial"
                    animate="in"
                    exit="out"
                    variants={pageVariants}
                    transition={pageTransition}
                  >
                    <Strategies />
                  </motion.div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics"
              element={
                <ProtectedRoute requireRole={UserRole.QUALIFIED_ALPHA}>
                  <motion.div
                    initial="initial"
                    animate="in"
                    exit="out"
                    variants={pageVariants}
                  >
                    <Analytics />
                  </motion.div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <motion.div
                    initial="initial"
                    animate="in"
                    exit="out"
                    variants={pageVariants}
                    transition={pageTransition}
                  >
                    <Profile />
                  </motion.div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <motion.div
                    initial="initial"
                    animate="in"
                    exit="out"
                    variants={pageVariants}
                    transition={pageTransition}
                  >
                    <Settings />
                  </motion.div>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AnimatePresence>
      </div>
    </div>
  );
};

// Old AppRouter removed - replaced with conditional version below



// Conditional WebSocket Connection Component - Only for VERIFIED users
const ConditionalWebSocketInitializer = () => {
  const { user, isAuthenticated } = useAuth();

  React.useEffect(() => {
    // Only initialize WebSocket for authenticated VERIFIED users
    if (isAuthenticated && user?.userLevel === 'VERIFIED') {
      console.log('📡 Initializing WebSocket for VERIFIED user:', user.email);

      // Initialize WebSocket connection for market data
      const socket = io(getWebSocketUrl(), {
        withCredentials: true,
        transports: ["websocket", "polling"],
      });

      // Set up the socket in the subscription manager
      websocketSubscriptionManager.setSocket(socket, 'verified-user-connection');

      console.log('📡 WebSocket connection initialized for VERIFIED user');

      return () => {
        // Cleanup when user logs out or level changes
        console.log('📡 Cleaning up WebSocket connection');
        websocketSubscriptionManager.cleanup();
        socket.disconnect();
      };
    } else if (!isAuthenticated || user?.userLevel !== 'VERIFIED') {
      // Clean up any existing connections for non-verified users
      websocketSubscriptionManager.cleanup();
    }
  }, [isAuthenticated, user?.userLevel, user?.email]);

  return null;
};



// App Router Component with Conditional Providers
const AppRouter = () => {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    // Minimal providers for unauthenticated users (login/register)
    return (
      <Router>
        <MinimalProviders>
          <div className="min-h-screen bg-background text-text">
            <Suspense fallback={<LoadingSpinner />}>
              <AnimatedRoutes />
            </Suspense>
          </div>
        </MinimalProviders>
      </Router>
    );
  }

  // Full providers for authenticated users
  return (
    <Router>
      <FullProviders>
        <div className="min-h-screen bg-background text-text">
          <Suspense fallback={<LoadingSpinner />}>
            <AnimatedRoutes />
          </Suspense>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "var(--bg-surface)",
                border: "1px solid var(--border-light)",
                color: "var(--text-primary)",
              },
            }}
          />
        </div>
      </FullProviders>
    </Router>
  );
};

// Main App Component - Only provides authentication context
function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <AppRouter />
    </ThemeProvider>
  );
}

export default App;
