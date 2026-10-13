/** @format */

import React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "../../utils";
import { Modal } from "./Modal";

/**
 * ConfirmDialog — a confirmation dialog for consequential (often destructive)
 * actions, built on the shared `Modal`.
 *
 * Replaces the native `confirm()` calls. Differences that matter:
 *  - a `tone` chooses the accent (danger / warning / info) so a destructive
 *    delete reads differently from a reversible action;
 *  - `loading` disables dismissal and both buttons while the request is in
 *    flight, preventing duplicate clicks;
 *  - `children` carries the context the generic browser dialog never could —
 *    e.g. the target's name and whether a bot is attached and in what state.
 *
 * The backend remains the authority on ownership/lifecycle; this only frames
 * the request and surfaces whatever the server returns.
 */

type ConfirmTone = "danger" | "warning" | "info";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Contextual detail rendered between the description and the actions. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** True while the confirm mutation is running — blocks dismissal + re-clicks. */
  loading?: boolean;
}

const toneStyles: Record<ConfirmTone, { icon: string; confirm: string }> = {
  danger: {
    icon: "text-danger",
    confirm: "bg-danger/20 text-danger border-danger/30 hover:bg-danger/30",
  },
  warning: {
    icon: "text-warning",
    confirm: "bg-warning/20 text-warning border-warning/30 hover:bg-warning/30",
  },
  info: {
    icon: "text-primary",
    confirm: "bg-primary/20 text-primary border-primary/30 hover:bg-primary/30",
  },
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
}) => {
  const styles = toneStyles[tone];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      // A mutation in flight must not be dismissible (no accidental double-submit
      // via Escape/backdrop).
      dismissible={!loading}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg font-medium border transition-colors text-sm disabled:opacity-50",
              styles.confirm
            )}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className={cn("w-5 h-5 shrink-0 mt-0.5", styles.icon)} />
        <div className="space-y-2">{children}</div>
      </div>
    </Modal>
  );
};
