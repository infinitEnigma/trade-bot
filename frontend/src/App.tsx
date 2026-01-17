/** @format */

import React, { Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { UserRole } from "@trade-bot/shared";

// Components
import LoadingSpinner from "./components/ui/LoadingSpinner";

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

// App Router Component
const AppRouter = () => {
  return (
    <Router>
      <div className="min-h-screen bg-background text-text">
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/strategies"
              element={
                <ProtectedRoute requireVerified={true}>
                  <Strategies />
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics"
              element={
                <ProtectedRoute requireRole={UserRole.QUALIFIED_ALPHA}>
                  <Analytics />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
};

// Main App Component
function App() {
  return (
    <AuthProvider>
      <AppRouter />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#13131a",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            color: "#e2e8f0",
          },
        }}
      />
    </AuthProvider>
  );
}

export default App;
