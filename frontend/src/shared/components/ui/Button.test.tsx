/** @format */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button component", () => {
  describe("basic functionality", () => {
    it("renders children correctly", () => {
      const buttonText = "Click Me";
      render(<Button>{buttonText}</Button>);
      
      expect(screen.getByText(buttonText)).toBeInTheDocument();
    });

    it("handles click events", () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);
      
      fireEvent.click(screen.getByText("Click Me"));
      
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("variants", () => {
    it("renders default variant", () => {
      render(<Button variant="default">Default Button</Button>);
      
      expect(screen.getByText("Default Button")).toBeInTheDocument();
    });

    it("renders secondary variant", () => {
      render(<Button variant="secondary">Secondary Button</Button>);
      
      expect(screen.getByText("Secondary Button")).toBeInTheDocument();
    });

    it("renders destructive variant", () => {
      render(<Button variant="destructive">Destructive Button</Button>);
      
      expect(screen.getByText("Destructive Button")).toBeInTheDocument();
    });

    it("renders success variant", () => {
      render(<Button variant="success">Success Button</Button>);
      
      expect(screen.getByText("Success Button")).toBeInTheDocument();
    });

    it("renders ghost variant", () => {
      render(<Button variant="ghost">Ghost Button</Button>);
      
      expect(screen.getByText("Ghost Button")).toBeInTheDocument();
    });
  });

  describe("sizes", () => {
    it("renders default size", () => {
      render(<Button>Default Size</Button>);
      
      expect(screen.getByText("Default Size")).toBeInTheDocument();
    });

    it("renders sm size", () => {
      render(<Button size="sm">Small Button</Button>);
      
      expect(screen.getByText("Small Button")).toBeInTheDocument();
    });

    it("renders md size", () => {
      render(<Button size="md">Medium Button</Button>);
      
      expect(screen.getByText("Medium Button")).toBeInTheDocument();
    });

    it("renders lg size", () => {
      render(<Button size="lg">Large Button</Button>);
      
      expect(screen.getByText("Large Button")).toBeInTheDocument();
    });

    it("renders icon size", () => {
      render(<Button size="icon">Icon</Button>);
      
      expect(screen.getByText("Icon")).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("renders loading indicator", () => {
      render(<Button loading>Loading...</Button>);
      
      expect(screen.getByRole("button")).toBeDisabled();
    });

    it("is disabled when loading", () => {
      render(<Button loading>Loading...</Button>);
      
      expect(screen.getByRole("button")).toBeDisabled();
    });
  });

  describe("disabled state", () => {
    it("is disabled when disabled prop is true", () => {
      render(<Button disabled>Disabled Button</Button>);
      
      expect(screen.getByText("Disabled Button")).toBeDisabled();
    });
  });

  describe("accessibility", () => {
    it("has accessible role", () => {
      render(<Button>Accessible Button</Button>);
      
      expect(screen.getByText("Accessible Button")).toHaveRole("button");
    });

    it("supports aria labels", () => {
      const ariaLabel = "Action button";
      render(<Button aria-label={ariaLabel}>Button</Button>);
      
      expect(screen.getByRole("button")).toHaveAttribute("aria-label", ariaLabel);
    });
  });
});