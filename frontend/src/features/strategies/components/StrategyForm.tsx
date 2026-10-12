/** @format */

/**
 * StrategyForm — modal orchestrator for the per-type create/edit flows.
 *
 * Replaces the old one-size 478-line form (type `<select>` + conditional
 * sections that let trend-only fields — leverage, stopLoss, entry/exit
 * thresholds — masquerade as grid options). The engine implements exactly
 * one strategy (`GridTradingStrategy`), so:
 *
 *  - CREATE: step 1 is the `StrategyTypeChooser` (Grid clickable, Trend /
 *    Arbitrage disabled "Coming soon"); picking Grid advances to step 2,
 *    `GridStrategyForm`. When a type ships, its card enables and its own
 *    form mounts here — this shell never grows conditional sections.
 *  - EDIT: a GRID row mounts `GridStrategyForm` in edit mode. A non-GRID
 *    row (impossible today — 29/29 prod rows are GRID) hits the defensive
 *    read-only branch instead of pretending to be editable.
 *
 * This component owns the overlay shell (frame, title, close) so switching
 * steps never re-renders the frame — the body-only chooser/forms mount
 * inside it.
 */

import React, { useState } from "react";
import { X, Zap } from "lucide-react";
import { Strategy, StrategyType } from "../../../shared/types";
import { getStrategyConfig } from "../types/strategies.types";
import { StrategyTypeChooser } from "./StrategyTypeChooser";
import { GridStrategyForm } from "./GridStrategyForm";

interface StrategyFormProps {
  strategy?: Strategy;
  onClose: () => void;
  /** `created` carries the freshly created strategy (create flow only). */
  onSuccess: (created?: Strategy | null) => void;
}

const formatStrategyType = (type: StrategyType): string =>
  type
    .toLowerCase()
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/**
 * Read-only details for the defensive edit branch — a strategy type with no
 * form yet is shown honestly rather than silently rejected or, worse,
 * editable with another type's fields.
 */
const ReadOnlyDetails: React.FC<{ strategy: Strategy }> = ({ strategy }) => {
  const strategyConfig = getStrategyConfig(strategy);
  return (
    <div className="p-6 space-y-4">
      <div className="p-4 rounded-xl border border-warning/20 bg-warning/5">
        <p className="text-sm text-warning">
          {formatStrategyType(strategy.type)} strategies are not editable yet —
          only Grid strategies have a form today. You can delete this strategy
          and recreate it once its form ships.
        </p>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-textMuted">Name</span>
          <span className="text-text font-medium">{strategy.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-textMuted">Type</span>
          <span className="text-text font-medium">
            {formatStrategyType(strategy.type)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-textMuted">Symbol</span>
          <span className="text-text font-medium">
            {strategyConfig && "symbol" in strategyConfig.config
              ? (strategyConfig.config.symbol as string) || "N/A"
              : "N/A"}
          </span>
        </div>
      </div>
    </div>
  );
};

export const StrategyForm: React.FC<StrategyFormProps> = ({
  strategy,
  onClose,
  onSuccess,
}) => {
  // Create flow starts on the type chooser; edit skips it (type is fixed).
  // `null` = chooser step; a StrategyType = that type's form step. Only
  // GRID is selectable today, but the state is typed for the future forms.
  const [selectedType, setSelectedType] = useState<StrategyType | null>(
    strategy ? strategy.type : null
  );

  const title = strategy
    ? "Edit Strategy"
    : selectedType
      ? `Create ${formatStrategyType(selectedType)} Strategy`
      : "Create New Strategy";

  const renderBody = () => {
    // Create flow, step 1: pick a type.
    if (selectedType === null) {
      return <StrategyTypeChooser onSelect={setSelectedType} />;
    }
    // Every flow below is the chosen type's form. Edit routes by the row's
    // own type; a non-GRID row falls through to the read-only branch.
    const formType = strategy ? strategy.type : selectedType;
    if (formType === StrategyType.GRID) {
      return (
        <GridStrategyForm
          strategy={strategy}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );
    }
    // Defensive: no form exists for this type yet (no non-GRID row can be
    // created today, and none exists in prod).
    if (strategy) return <ReadOnlyDetails strategy={strategy} />;
    // A future type selected in the chooser before its form ships.
    return (
      <div className="p-6">
        <p className="text-sm text-textMuted">
          The {formatStrategyType(formType)} form is not available yet.
        </p>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="glass-card rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="w-4 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-text-primary">{title}</h2>
            {/* Back to the chooser mid-create — never shown for edit, whose
                only exits are cancel/save. */}
            {!strategy && selectedType && (
              <button
                onClick={() => setSelectedType(null)}
                className="text-sm text-textMuted hover:text-text-primary"
              >
                ← Change type
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary p-1"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {renderBody()}
      </div>
    </div>
  );
};
