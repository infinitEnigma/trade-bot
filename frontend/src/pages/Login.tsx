/** @format */

import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageLayout } from "../components/layout";
import { ValidatedInput } from "../components/ui/ValidatedInput";
import { validateEmail } from "../lib/validation";

const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Redirect when authentication succeeds
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard");
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await login(email, password);
      // AuthContext will handle redirect when isAuthenticated becomes true
    } catch (error) {
      // Error is already handled in the context
    } finally {
      setLoading(false);
    }
  };

  const emailValidation = validateEmail(email);

  return (
    <PageLayout className="flex items-center justify-center px-4">
      <div className="w-full max-w-md mx-auto">
        <div className="glass-card p-8 text-center">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-text mb-2">Welcome Back</h1>
            <p className="text-textMuted">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <ValidatedInput
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              validation={{
                isValid: emailValidation.isValid,
                message: emailValidation.message,
                touched: email.length > 0
              }}
              placeholder="your@email.com"
              required
            />

            <ValidatedInput
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              validation={{
                isValid: true,
                message: "",
                touched: password.length > 0
              }}
              placeholder="••••••••"
              required
            />

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-textMuted">
              Don't have an account?{" "}
              <Link
                to="/register"
                className="text-primary hover:text-primaryHover"
              >
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default Login;
