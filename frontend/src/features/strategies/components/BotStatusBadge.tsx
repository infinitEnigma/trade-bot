/** @format */

import React from "react";
import { Loader2, CheckCircle2, OctagonAlert, CircleSlash } from "lucide-react";
import { cn } from "../../../shared/utils";
import { BotInstance } from "../types/strategies.types";
import { getStateDisplayInfo } from "../../bots/hooks";

/**
 * BotStatusBadge — a single, honest rendering of a bot's lifecycle state.
 *
 * The old card mapped only RUNNING (green) / STOPPED (amber) and threw every
 * other status into the danger color, so a transitional STARTING/STOPPING read
 * as a failure. This maps each real state to its own label + color, and — most
 * importantly — surfaces the two "you must do something" conditions
 * (`needsUserAction` reconcile-park, and a lost-engine `UNKNOWN`) as a distinct
 * **"Needs attention"** state with an explanatory line, rather than a bare red
 * badge that tells the operator nothing about the next safe action.
 *
 * Transitional states get a spinner; the rest get a static glyph.
 */

interface BotStatusBadgeProps {
  bot: BotInstance;
  /** Hide the one-line explanation under the badge (compact placements). */
  hideDetail?: boolean;
}

type Resolved = {
  label: string;
  badge: string;
  glyph: "spinner" | "ok" | "attention" | "stopped";
  detail?: string;
};

function resolveStatus(bot: BotInstance): Resolved {
  // P0-3: an unresolved RECONCILE_NEEDS_USER_ACTION — the engine was lost
  // while the user still wants it running, and the system deliberately will
  // NOT auto-start it. This wins over the raw status label because it is the
  // actionable truth: the operator must Resume when ready.
  if (bot.needsUserAction) {
    return {
      label: "Needs attention",
      badge: "bg-danger/20 text-danger",
      glyph: "attention",
      detail:
        bot.needsUserActionReason ||
        "The trading engine was lost and this bot was not restarted automatically. Resume it when you are ready.",
    };
  }

  switch (bot.status) {
    case "RUNNING":
      return {
        label: "Running",
        badge: "bg-success/20 text-success",
        glyph: "ok",
        detail: "Actively trading.",
      };
    case "STARTING":
      return {
        label: "Starting…",
        badge: "bg-warning/20 text-warning",
        glyph: "spinner",
        detail: "Initializing the trading engine.",
      };
    case "STOPPING":
      return {
        label: "Stopping…",
        badge: "bg-warning/20 text-warning",
        glyph: "spinner",
        detail: "Winding down safely.",
      };
    case "STOPPED":
      return {
        label: "Stopped",
        badge: "bg-white/10 text-textMuted",
        glyph: "stopped",
        detail: "Ready to start.",
      };
    case "UNKNOWN":
      // Engine unreachable / heartbeat lost — distinct from ERROR, and an
      // operator-action condition (Resume re-drives the same bot).
      return {
        label: "Needs attention",
        badge: "bg-danger/20 text-danger",
        glyph: "attention",
        detail:
          "Connection to the trading engine was lost. Resume restarts this bot without duplicating it.",
      };
    case "ERROR":
    default: {
      const info = getStateDisplayInfo(bot.status);
      return {
        label: info?.label ?? "Error",
        badge: "bg-danger/20 text-danger",
        glyph: "attention",
        detail: "Bot is in an error state — check its logs before resuming.",
      };
    }
  }
}

function Glyph({ kind }: { kind: Resolved["glyph"] }) {
  switch (kind) {
    case "spinner":
      return <Loader2 className="w-3 h-3 animate-spin" />;
    case "ok":
      return <CheckCircle2 className="w-3 h-3" />;
    case "attention":
      return <OctagonAlert className="w-3 h-3" />;
    case "stopped":
    default:
      return <CircleSlash className="w-3 h-3" />;
  }
}

export const BotStatusBadge: React.FC<BotStatusBadgeProps> = ({
  bot,
  hideDetail = false,
}) => {
  const { label, badge, glyph, detail } = resolveStatus(bot);

  return (
    <div className="space-y-1">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full",
          badge
        )}
      >
        <Glyph kind={glyph} />
        {label}
      </span>
      {!hideDetail && detail && (
        <p className="text-xs text-textMuted">{detail}</p>
      )}
    </div>
  );
};
