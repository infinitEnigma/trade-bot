/** @format */

import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";

// Pages
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Strategies from "./pages/Strategies";
import Settings from "./pages/Settings";

// Components
import LoadingSpinner from "./components/ui/LoadingSpinner";

// Protected Route Component
const ProtectedRoute = ({
  children,
  requireVerified = false,
}: {
  children: React.ReactNode;
  requireVerified?: boolean;
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

  return <>{children}</>;
};

// App Router Component
const AppRouter = () => {
  return (
    <Router>
      <div className="min-h-screen bg-background text-text">
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
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
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
