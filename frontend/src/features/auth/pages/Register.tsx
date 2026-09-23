/** @format */

import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth";
import { PageLayout } from "../../../shared/components/layout";
import { ValidatedInput } from "../../../shared/components/forms";
import {
  validateEmail,
  validateUsername,
  validatePasswordRequirements,
  validatePasswordConfirmation,
} from "../../../shared/validation";

const Register: React.FC = () => {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const usernameValidation = validateUsername(username);
  const emailValidation = validateEmail(email);
  const passwordValidation = validatePasswordRequirements(password);
  const confirmValidation = validatePasswordConfirmation(
    password,
    confirmPassword
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !usernameValidation.isValid ||
      !emailValidation.isValid ||
      !passwordValidation.isValid ||
      !confirmValidation.isValid
    ) {
      return; // Validation errors will be shown
    }

    setLoading(true);

    try {
      await register({
        username: username.trim() || undefined,
        email,
        password,
      });
      navigate("/dashboard");
    } catch {
      // Error is already handled in the context
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout className="flex items-center justify-center px-4">
      <div className="w-full max-w-md mx-auto">
        <div className="glass-card p-8 text-center">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-text mb-2">
              Create Account
            </h1>
            <p className="text-textMuted">Join the Trade Bot platform</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <ValidatedInput
              label="Username (optional)"
              type="text"
              value={username}
              onChange={setUsername}
              validation={{
                isValid: usernameValidation.isValid,
                message: usernameValidation.message,
                touched: username.length > 0,
              }}
              placeholder="your_handle — left blank, we derive one from your email"
              required
            />

            <ValidatedInput
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              validation={{
                isValid: emailValidation.isValid,
                message: emailValidation.message,
                touched: email.length > 0,
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
                isValid: passwordValidation.isValid,
                message: passwordValidation.message,
                touched: password.length > 0,
              }}
              placeholder="••••••••"
              required
            />

            <ValidatedInput
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              validation={{
                isValid: confirmValidation.isValid,
                message: confirmValidation.message,
                touched: confirmPassword.length > 0,
              }}
              placeholder="••••••••"
              required
            />

            <button
              type="submit"
              disabled={
                loading ||
                !usernameValidation.isValid ||
                !emailValidation.isValid ||
                !passwordValidation.isValid ||
                !confirmValidation.isValid
              }
              className="btn-primary w-full"
            >
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-textMuted">
              Already have an account?{" "}
              <Link
                to="/login"
                className="text-primary hover:text-primaryHover"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default Register;
