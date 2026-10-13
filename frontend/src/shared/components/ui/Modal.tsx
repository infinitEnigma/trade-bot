/** @format */

import React, { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "../../utils";

/**
 * Modal — the shared overlay dialog primitive.
 *
 * The app previously used the browser's native `confirm()`/`window.confirm()`
 * for destructive actions, which gives no styling, no context, and no room for
 * a secondary explanation. This provides a consistent in-app dialog:
 *
 *  - renders nothing when `open` is false (no hidden DOM);
 *  - locks body scroll while open;
 *  - closes on Escape and on backdrop click when `dismissible` (default true);
 *  - `role="dialog"` + `aria-modal` + a labelled title for assistive tech.
 *
 * Deliberately dependency-free (no headlessui): the app has no dialog library,
 * and this keeps the primitive aligned with the existing `fixed inset-0
 * bg-black/50` overlay convention already used across the feature modals.
 */

type ModalSize = "sm" | "md" | "lg";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Optional supporting line under the title. */
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Footer row (typically Cancel / Confirm actions), right-aligned. */
  footer?: React.ReactNode;
  size?: ModalSize;
  /**
   * When false, Escape and backdrop clicks are ignored (e.g. a mutation is in
   * flight and the dialog must not be dismissed mid-request).
   */
  dismissible?: boolean;
  /** Accessible name when `title` is not a plain string. */
  ariaLabel?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  ariaLabel,
}) => {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    // Lock background scroll while the dialog is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dismissible ? onClose : undefined}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={
          ariaLabel ?? (typeof title === "string" ? title : undefined)
        }
        onClick={event => event.stopPropagation()}
        className={cn("glass-card w-full space-y-4", sizeClasses[size])}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-text">{title}</h3>
            {description && (
              <p className="text-sm text-textMuted">{description}</p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="p-1 rounded-lg text-textMuted hover:text-text hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {children && <div className="text-sm text-textMuted">{children}</div>}

        {footer && <div className="flex justify-end gap-3 pt-2">{footer}</div>}
      </div>
    </div>
  );
};
