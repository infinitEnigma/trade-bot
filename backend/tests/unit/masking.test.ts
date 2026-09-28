/**
 * Email masking (L6) — logs carry a masked address, the audit trail keeps the
 * real one. Used by the auth service and the auth routes.
 */

import { maskEmail } from "../../src/shared/utils/masking";

describe("maskEmail", () => {
  it("masks the local part and keeps the domain readable", () => {
    expect(maskEmail("john.doe@example.com")).toBe("j***e@example.com");
  });

  it("keeps one- and two-character local parts readable", () => {
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
    expect(maskEmail("ab@example.com")).toBe("a***@example.com");
  });

  it("returns a constant when there is no usable local/domain split", () => {
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });

  it("returns an empty string for empty input", () => {
    expect(maskEmail("")).toBe("");
    expect(maskEmail("   ")).toBe("");
    expect(maskEmail(null)).toBe("");
    expect(maskEmail(undefined)).toBe("");
  });

  it("never returns the full local part", () => {
    const local = "verylonglocalpart";
    const masked = maskEmail(`${local}@example.com`);

    expect(masked).not.toContain(local);
    expect(masked.endsWith("@example.com")).toBe(true);
  });
});
