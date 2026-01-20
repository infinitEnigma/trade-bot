/** @format */

// COMPATIBILITY LAYER - Phase 1
// These exports maintain backward compatibility during the restructure
// TODO: Update imports throughout the codebase to use new locations, then remove this file

// Re-export from new shared locations
export { Button } from "../../shared/components/ui/Button";
export { Card } from "../../shared/components/ui/Card";
export { default as LoadingSpinner } from "../../shared/components/ui/LoadingSpinner";
export { ErrorState } from "../../shared/components/ui/ErrorState";
export { SectionHeader } from "../../shared/components/ui/SectionHeader";
export { MetricIcon } from "../../shared/components/ui/MetricIcon";
export { ThemeToggle } from "../../shared/components/ui/ThemeToggle";
export { TimeWindowSelector } from "../../shared/components/ui/TimeWindowSelector";

// Re-export layout components
export { Container, Grid, PageLayout, Section } from "../../shared/components/layout";

// Re-export form components
export { ValidatedInput } from "../../shared/components/forms";

// Re-export feedback components
export { AnalyticsLoading } from "../../shared/components/feedback";
