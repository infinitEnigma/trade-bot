/** @format */

/**
 * StrategyForm — the per-type create/edit flow, in a side drawer.
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
 * This component owns the drawer shell (frame, title, close) so switching
 * steps never re-renders the frame — the body-only chooser/forms mount
 * inside it.
 *
 * F5: a DRAWER, not the centred full-screen modal it used to be. The old shell
 * covered the whole viewport, which hid the chart exactly when the operator
 * needed it — while configuring a grid. This one anchors to the right edge:
 * below `lg` it still covers the screen (with a dimming, click-to-close
 * scrim), from `lg` up the scrim is transparent and click-through so the chart
 * stays fully visible and usable beside the form.
 */

import React, { useState } from "react";
import { X, Zap } from "lucide-react";
import { Strategy, StrategyType } from "../../../shared/types";
import type { GridPreviewInput } from "../../../shared/components/charts/gridPreview";
import { getStrategyConfig } from "../types/strategies.types";
import { StrategyTypeChooser } from "./StrategyTypeChooser";
import { GridStrategyForm } from "./GridStrategyForm";

interface StrategyFormProps {
  strategy?: Strategy;
  onClose: () => void;
  /** `created` carries the freshly created strategy (create flow only). */
  onSuccess: (created?: Strategy | null) => void;
  /**
   * F5: the mounted form reports the grid it is configuring, live as the
   * operator types, so the chart panel can draw it. `null` for a step that
   * configures no grid (the type chooser, the read-only branch). Optional:
   * callers that do not want a preview simply omit it.
   */
  onPreviewChange?: (preview: GridPreviewInput | null) => void;
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
  onPreviewChange,
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
          onPreviewChange={onPreviewChange}
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
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Scrim: dims and catches clicks on small screens, where the drawer
          covers the viewport. From `lg` up it is transparent AND
          click-through, so the chart beside the form stays fully visible and
          usable while editing — the whole point of F5. */}
      <div
        className="absolute inset-0 bg-black/40 lg:bg-transparent lg:pointer-events-none"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full sm:max-w-md h-full glass-card border-l border-white/10 overflow-y-auto shadow-2xl"
      >
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
