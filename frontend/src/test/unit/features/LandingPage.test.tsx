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

  it('should have a working "Get Started" button', async () => {
    render(<LandingPage />);

    const getStartedButton = screen.getByRole("button", {
      name: "Get Started →",
    });
    fireEvent.click(getStartedButton);

    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  it('should have a working "Start Trading Today" button', async () => {
    render(<LandingPage />);

    const startTradingButton = screen.getByRole("button", {
      name: "Start Trading Today",
    });
    fireEvent.click(startTradingButton);

    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  it("should display all 6 features", async () => {
    render(<LandingPage />);

    const features = [
      "Automated Trading",
      "Smart Analytics",
      "AI-Powered Strategies",
      "Educational Resources",
      "Secure Platform",
      "Global Markets",
    ];

    features.forEach(feature => {
      expect(screen.getByText(feature)).toBeInTheDocument();
    });
  });

  it("should display statistics section", async () => {
    render(<LandingPage />);

    expect(screen.getByText("99.9%")).toBeInTheDocument();
    expect(screen.getByText("Uptime Guarantee")).toBeInTheDocument();
    expect(screen.getByText("24/7")).toBeInTheDocument();
    expect(screen.getAllByText("Support")).toHaveLength(2);
    expect(screen.getByText("10K+")).toBeInTheDocument();
    expect(screen.getByText("Active Traders")).toBeInTheDocument();
  });

  it("should render the footer with links", async () => {
    render(<LandingPage />);

    expect(
      screen.getByText(/©.*Rewire.*All rights reserved/)
    ).toBeInTheDocument();
    expect(screen.getByText("Terms")).toBeInTheDocument();
    expect(screen.getByText("Privacy")).toBeInTheDocument();
    expect(screen.getByText("Contact")).toBeInTheDocument();
    // Check for footer links specifically
    expect(screen.getByRole("link", { name: "Support" })).toBeInTheDocument();
  });
});
