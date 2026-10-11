import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EngineJournalIntegrityNotice } from "./EngineJournalIntegrityNotice";

/**
 * Pins the F4 UI precedence contract: the sticky reconciliation alert (observed
 * UNKNOWN) is reserved for a confirmed accounting gap; UNVERIFIED is a softer,
 * verification-pending warning — neither alarming nor invisible; OK shows
 * nothing. The sticky alert always wins when both are present.
 */
describe("EngineJournalIntegrityNotice", () => {
  it("shows the verification-pending warning for UNVERIFIED with no alert", () => {
    render(
      <EngineJournalIntegrityNotice
        journalIntegrity="UNVERIFIED"
        journalIntegrityAlert={false}
      />
    );
    expect(
      screen.getByText("Fill-journal integrity not yet verified")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Accounting reconciliation required")
    ).not.toBeInTheDocument();
  });

  it("shows the reconciliation alert and NOT the warning when the sticky alert is set", () => {
    render(
      <EngineJournalIntegrityNotice
        journalIntegrity="UNVERIFIED"
        journalIntegrityAlert={true}
      />
    );
    expect(
      screen.getByText("Accounting reconciliation required")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Fill-journal integrity not yet verified")
    ).not.toBeInTheDocument();
  });

  it("shows the reconciliation alert for UNKNOWN live state with the sticky alert", () => {
    render(
      <EngineJournalIntegrityNotice
        journalIntegrity="UNKNOWN"
        journalIntegrityAlert={true}
      />
    );
    expect(
      screen.getByText("Accounting reconciliation required")
    ).toBeInTheDocument();
  });

  it("renders nothing when integrity is OK", () => {
    const { container } = render(
      <EngineJournalIntegrityNotice
        journalIntegrity="OK"
        journalIntegrityAlert={false}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the compact row variant for UNVERIFIED", () => {
    render(
      <EngineJournalIntegrityNotice
        journalIntegrity="UNVERIFIED"
        journalIntegrityAlert={false}
        variant="row"
      />
    );
    expect(screen.getByText("Fill Journal")).toBeInTheDocument();
    expect(screen.getByText("Not yet verified")).toBeInTheDocument();
  });
});
