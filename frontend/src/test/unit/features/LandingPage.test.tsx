/** @format */

import { describe, it, expect, vi, Mock } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LandingPage } from "../../../features/landing/pages/LandingPage";
import { useNavigate } from "react-router-dom";

// Mock the useNavigate hook
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: vi.fn(),
  };
});

// Mock framer-motion to disable animations in tests
vi.mock("framer-motion", async () => {
  const actual =
    await vi.importActual<typeof import("framer-motion")>("framer-motion");
  // Render motion elements as plain DOM nodes, forwarding the remaining props
  // exactly as the previous inline `any`-typed stubs did.
  const MotionStub = ({ children, ...props }: ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  );
  return {
    ...actual,
    motion: {
      ...actual.motion,
      div: MotionStub,
      h1: MotionStub,
      h2: MotionStub,
      p: MotionStub,
    },
  };
});

describe("LandingPage", () => {
  const mockNavigate = vi.fn();

  beforeEach(() => {
    (useNavigate as Mock).mockReturnValue(mockNavigate);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should render the LandingPage with basic elements", async () => {
    render(<LandingPage />);

    // Check for main sections
    expect(screen.getAllByText("Rewire")).toHaveLength(2);
    expect(
      screen.getByText("Transform Your Trading Journey")
    ).toBeInTheDocument();
    expect(screen.getByText("Rewire Your")).toBeInTheDocument();
    expect(screen.getByText("Financial Future")).toBeInTheDocument();
    expect(
      screen.getByText(/Discover a smarter way to trade/)
    ).toBeInTheDocument();
  });

  it("should have a working login button in the navigation", async () => {
    render(<LandingPage />);

    const loginButton = screen.getByRole("button", { name: "Login" });
    fireEvent.click(loginButton);

    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  it('should have a working "Get Started" button (register path)', async () => {
    render(<LandingPage />);

    const getStartedButton = screen.getByRole("button", {
      name: "Get Started →",
    });
    fireEvent.click(getStartedButton);

    expect(mockNavigate).toHaveBeenCalledWith("/register");
  });

  it('should have a "Create account" path in the navigation', async () => {
    render(<LandingPage />);

    const createAccountButton = screen.getByRole("button", {
      name: "Create account",
    });
    fireEvent.click(createAccountButton);

    expect(mockNavigate).toHaveBeenCalledWith("/register");
  });

  it('should have a working "Start Trading Today" button', async () => {
    render(<LandingPage />);

    const startTradingButton = screen.getByRole("button", {
      name: "Start Trading Today",
    });
    fireEvent.click(startTradingButton);

    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  it("should display all 5 features with honest copy", async () => {
    render(<LandingPage />);

    const features = [
      "Automated Trading",
      "Smart Analytics",
      "Automated Execution",
      "Secure Platform",
      "Global Markets",
    ];

    features.forEach(feature => {
      expect(screen.getByText(feature)).toBeInTheDocument();
    });

    // HD4/E5: no AI/ML claims, no non-existent resources
    expect(screen.queryByText("AI-Powered Strategies")).not.toBeInTheDocument();
    expect(screen.queryByText("Educational Resources")).not.toBeInTheDocument();
  });

  it("shows honest verifiable stats and no fabricated claims", async () => {
    render(<LandingPage />);

    // The banned, unverifiable social-proof claims stay gone (HD4/E5).
    expect(screen.queryByText("99.9%")).not.toBeInTheDocument();
    expect(screen.queryByText("10K+")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Traders")).not.toBeInTheDocument();
    expect(screen.queryByText("Uptime Guarantee")).not.toBeInTheDocument();

    // The stats bar is restored with figures verifiable from the platform:
    // always-on execution, 2 connected exchanges, 3 strategy types.
    expect(screen.getByText("24/7")).toBeInTheDocument();
    expect(screen.getByText("Automated execution")).toBeInTheDocument();
    expect(screen.getByText("Connected exchanges")).toBeInTheDocument();
    expect(screen.getByText("Strategy types")).toBeInTheDocument();
  });

  it("should render the footer with plain-text items and dynamic year", async () => {
    render(<LandingPage />);

    expect(
      screen.getByText(/©.*Rewire.*All rights reserved/)
    ).toBeInTheDocument();
    expect(screen.getByText("Terms")).toBeInTheDocument();
    expect(screen.getByText("Privacy")).toBeInTheDocument();
    expect(screen.getByText("Contact")).toBeInTheDocument();
    // HD4: footer items are plain text, not dead href="#" links
    expect(
      screen.queryByRole("link", { name: "Support" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
  });
});
