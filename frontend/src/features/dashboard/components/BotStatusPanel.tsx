/** @format */

import React from "react";
import { Link } from "react-router-dom";
import { Activity, Loader2, OctagonAlert } from "lucide-react";
import { Card } from "../../../shared/components/ui/Card";
import { useBotsList } from "../../bots/hooks";
import { summarizeBotStates } from "../../strategies/utils/summarizeBotStates";
import type { BotInstance } from "../../strategies/types/strategies.types";

/** `id → "EXCHANGE (env) ref"` display label for each ACTIVE account. */
interface BotStatusPanelProps {
  accountLabels: Record<string, string>;
}

/**
 * Bot status panel — VERIFIED's operational summary at the top of the
 * trading section. Counts row (disjoint buckets from `summarizeBotStates`)
 * plus the needs-attention list FIRST with `needsUserActionReason` shown,
 * so an operator sees "what needs me" before the healthy rows.
 *
 * Display only: links resolve into /strategies; no start/stop controls live
 * here (there is deliberately no second Strategies page). Account labels
 * come from `exchange_account_id` where present — bots are NEVER filtered
 * by account (legacy rows carry a null id and would vanish).
 */
const needsAttention = (bots: BotInstance[]): BotInstance[] =>
  bots.filter(
    b => b.needsUserAction || b.status === "UNKNOWN" || b.status === "ERROR"
  );

const accountLabelFor = (
  bot: BotInstance,
  accountLabels: Record<string, string>
): string | null => {
  const id = bot.exchange_account_id;
  if (!id) return null;
  return accountLabels[id] ?? id;
};

export const BotStatusPanel: React.FC<BotStatusPanelProps> = ({
  accountLabels,
}) => {
  const { bots, isLoading } = useBotsList();
  const summary = summarizeBotStates(bots);
  const attention = needsAttention(bots);

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-textMuted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading bot status…</span>
        </div>
      </Card>
    );
  }

  if (bots.length === 0) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <Activity className="w-5 h-5 text-textMuted mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-text">No bots yet</h3>
            <p className="text-sm text-textMuted mt-1">
              Start a bot from a strategy to see live status here.
            </p>
            <Link
              to="/strategies"
              className="text-sm text-textMuted hover:text-text underline underline-offset-4 mt-2 inline-block"
            >
              Open Strategies
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4">
        <span className="text-sm text-textMuted">
          {summary.total} bot{summary.total === 1 ? "" : "s"}
        </span>
        <span className="text-sm text-success">{summary.running} running</span>
        <span className="text-sm text-warning">
          {summary.transitional} starting / stopping
        </span>
        <span className="text-sm text-textMuted">
          {summary.stopped} stopped
        </span>
        {summary.needsAttention > 0 && (
          <span className="text-sm text-danger font-medium">
            {summary.needsAttention} need
            {summary.needsAttention === 1 ? "s" : ""} attention
          </span>
        )}
      </div>

      {attention.length > 0 && (
        <ul className="space-y-3 mb-4">
          {attention.map(bot => {
            const account = accountLabelFor(bot, accountLabels);
            const reason =
              bot.needsUserActionReason ??
              (bot.status === "UNKNOWN"
                ? "Connection to the trading engine was lost."
                : "Bot is in an error state — check its logs before resuming.");
            return (
              <li
                key={bot.id}
                className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3"
              >
                <OctagonAlert className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="text-sm font-medium text-text">
                      Bot {bot.id.slice(0, 8)}
                    </span>
                    {account && (
                      <span className="text-xs text-textMuted">{account}</span>
                    )}
                    <Link
                      to="/strategies"
                      className="text-xs text-textMuted hover:text-text underline underline-offset-4"
                    >
                      Open in Strategies
                    </Link>
                  </div>
                  <p className="text-xs text-textMuted mt-1">{reason}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        to="/strategies"
        className="text-sm text-textMuted hover:text-text underline underline-offset-4"
      >
        Manage Strategies
      </Link>
    </Card>
  );
};
