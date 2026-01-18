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
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { UserRole } from "@trade-bot/shared";

// Components
import LoadingSpinner from "./components/ui/LoadingSpinner";
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
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
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



// Main App Component
function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <AuthProvider>
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
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
