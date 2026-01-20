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
import { UserRole } from "@trade-bot/shared";

// Components
import { LoadingSpinner } from "./shared/components/ui";
import { AppHeader } from "./components/ui/AppHeader";

// Lazy load pages
const Login = React.lazy(() => import("./pages/Login"));
const Register = React.lazy(() => import("./pages/Register"));
const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const Strategies = React.lazy(() => import("./pages/Strategies"));
const Settings = React.lazy(() => import("./pages/Settings"));
const Analytics = React.lazy(() => import("./pages/Analytics"));
const Profile = React.lazy(() => import("./pages/Profile"));

// Protected Route Component
const ProtectedRoute = ({
  children,
  requireVerified = false,
  requireRole,
}: {
  children: React.ReactNode;
  requireVerified?: boolean;
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

  if (requireRole && !user?.roles?.includes(requireRole)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

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
                <ProtectedRoute requireVerified={true}>
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
                    transition={pageTransition}
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

// App Router Component
const AppRouter = () => {
  return (
    <Router>
      <div className="min-h-screen bg-background text-text">
        <Suspense fallback={<LoadingSpinner />}>
          <AnimatedRoutes />
        </Suspense>
      </div>
    </Router>
  );
};



// WebSocket Connection Component
const WebSocketInitializer = () => {
  React.useEffect(() => {
    // Initialize WebSocket connection for market data
    const socket = io("https://rewireapp.ddns.net", {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    // Set up the socket in the subscription manager
    websocketSubscriptionManager.setSocket(socket, 'main-connection');

    console.log('📡 WebSocket connection initialized');

    return () => {
      // Cleanup on app unmount
      websocketSubscriptionManager.cleanup();
      socket.disconnect();
    };
  }, []);

  return null;
};

// Main App Component
function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <ErrorProvider>
        <WebSocketInitializer />
        <AppRouter />
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
        <ErrorNotifications />
      </ErrorProvider>
    </ThemeProvider>
  );
}

export default App;
