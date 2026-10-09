/** @format */

import React, { Component, ErrorInfo, ReactNode } from "react";

/**
 * Top-level React error boundary.
 *
 * WHY THIS EXISTS: the app previously shipped with no error boundary, so any
 * render-time throw unmounted the entire React tree to a blank white screen —
 * no explanation, no recovery. This bit hardest on `/strategies`, where a
 * shared TanStack Query observer flipping to `data: undefined` can make a
 * card's `.map`/`.find` throw and take the whole page down behind the
 * AnimatePresence background (see the notes in `useBotLifecycle.ts` and
 * `Strategies.tsx`).
 *
 * This boundary, on a caught render error:
 * - logs the error AND the React `componentStack` to `console.error` — the
 *   component stack names the exact crashing component, which is the
 *   diagnostic that was previously invisible on a blank page;
 * - renders a recoverable fallback (retry / reload + collapsible detail)
 *   instead of a white screen.
 *
 * A boundary must be a class component (no hook equivalent for
 * `componentDidCatch`/`getDerivedStateFromError`). It deliberately does NOT
 * read `ErrorContext`: it sits above that provider, and touching context here
 * could itself throw during the very render we are trying to contain.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

const DefaultErrorFallback: React.FC<{
  error: Error;
  componentStack: string | null;
  onRetry: () => void;
  onReload: () => void;
}> = ({ error, componentStack, onRetry, onReload }) => (
  <div className="min-h-screen flex items-center justify-center bg-background p-6">
    <div className="glass-card p-8 w-full max-w-lg text-center space-y-4">
      <div className="w-12 h-12 mx-auto rounded-full bg-danger/10 flex items-center justify-center">
        <span className="text-danger text-xl font-bold">!</span>
      </div>
      <h1 className="text-xl font-bold text-text">Something went wrong</h1>
      <p className="text-sm text-textMuted">
        This page hit an unexpected error. You can try again, reload, or head
        back to the dashboard. The details below (also in your browser console)
        help us fix it.
      </p>

      <div className="flex items-center justify-center gap-3">
        <button onClick={onRetry} className="btn-secondary">
          Try again
        </button>
        <button onClick={onReload} className="btn-primary">
          Reload page
        </button>
      </div>

      <details className="text-left mt-2">
        <summary className="text-xs text-textMuted cursor-pointer select-none">
          Error details
        </summary>
        <pre className="mt-2 text-xs text-text-tertiary whitespace-pre-wrap break-words max-h-64 overflow-auto">
          {error.message}
          {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
        </pre>
      </details>
    </div>
  </div>
);

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // The component stack names the crashing component — the diagnostic that
    // was previously lost to a blank screen. Log it where DevTools shows it.
    console.error("ErrorBoundary caught a render error:", error);
    console.error("Component stack:", errorInfo.componentStack);
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  private handleReset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) {
      return this.props.fallback(error, this.handleReset);
    }
    return (
      <DefaultErrorFallback
        error={error}
        componentStack={componentStack}
        onRetry={this.handleReset}
        onReload={this.handleReload}
      />
    );
  }
}

export default ErrorBoundary;
