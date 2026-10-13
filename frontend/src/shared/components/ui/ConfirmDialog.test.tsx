/** @format */

/**
 * ConfirmDialog contract (P1 safer destructive actions): renders nothing while
 * closed; fires onConfirm; and — critically for duplicate-submit safety — is
 * NON-dismissible while `loading` (no Escape/backdrop close, both actions
 * disabled). This replaces the native confirm() the app used for delete.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <ConfirmDialog
        open={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete strategy?"
      />
    );
    expect(screen.queryByText("Delete strategy?")).toBeNull();
  });

  it("shows title + custom labels and fires onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        title="Delete strategy?"
        confirmLabel="Delete"
        cancelLabel="Keep"
      >
        <p>This can't be undone.</p>
      </ConfirmDialog>
    );
    expect(screen.getByText("Delete strategy?")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires onClose from the cancel button", () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Delete strategy?"
        cancelLabel="Cancel"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is non-dismissible and blocks both actions while loading", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete strategy?"
        loading
        confirmLabel="Deleting…"
      />
    );

    const confirmBtn = screen.getByRole("button", { name: /Deleting/ });
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);

    // Escape must not dismiss a request in flight.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(confirmBtn);
    fireEvent.click(cancelBtn);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
