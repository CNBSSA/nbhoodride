import { describe, expect, it } from "vitest";
import {
  evaluateEmailVerificationGate,
  isEmailVerificationMandatory,
} from "./emailVerificationPolicy";

const now = new Date("2026-09-04T12:00:00Z"); // after the mandatory date
const unverifiedRider = { registrationCompletedAt: new Date("2026-09-01T00:00:00Z") };

describe("isEmailVerificationMandatory", () => {
  it("is not mandatory before the cutoff and is after", () => {
    expect(isEmailVerificationMandatory(new Date("2026-08-09T00:00:00Z"))).toBe(false);
    expect(isEmailVerificationMandatory(now)).toBe(true);
  });
});

describe("evaluateEmailVerificationGate", () => {
  it("blocks an unverified rider when email genuinely works", () => {
    expect(evaluateEmailVerificationGate(unverifiedRider, { emailDeliverable: true, now })).toEqual({ allow: false });
  });

  it("lets a verified rider through", () => {
    const res = evaluateEmailVerificationGate(
      { ...unverifiedRider, emailVerifiedAt: new Date() },
      { emailDeliverable: true, now },
    );
    expect(res).toEqual({ allow: true, waive: false, reason: "verified" });
  });

  it("waives the requirement when the server cannot send verification email", () => {
    const res = evaluateEmailVerificationGate(unverifiedRider, { emailDeliverable: false, now });
    expect(res).toEqual({ allow: true, waive: true, reason: "email_undeliverable" });
  });

  it("keeps a previously waived rider in once email is repaired", () => {
    // The regression this guards: fixing email must not lock out people who
    // were already admitted during the outage.
    const waived = { ...unverifiedRider, emailVerificationWaivedAt: new Date("2026-09-04T01:00:00Z") };
    const res = evaluateEmailVerificationGate(waived, { emailDeliverable: true, now });
    expect(res).toEqual({ allow: true, waive: false, reason: "waived_previously" });
  });

  it("never waives twice", () => {
    const first = evaluateEmailVerificationGate(unverifiedRider, { emailDeliverable: false, now });
    expect(first).toMatchObject({ waive: true });
    const second = evaluateEmailVerificationGate(
      { ...unverifiedRider, emailVerificationWaivedAt: new Date() },
      { emailDeliverable: false, now },
    );
    expect(second).toMatchObject({ waive: false });
  });

  it("exempts admins", () => {
    expect(evaluateEmailVerificationGate({ ...unverifiedRider, isAdmin: true }, { emailDeliverable: true, now }))
      .toMatchObject({ allow: true, reason: "admin" });
  });

  it("exempts accounts created before the verification flow existed", () => {
    expect(evaluateEmailVerificationGate({}, { emailDeliverable: true, now }))
      .toMatchObject({ allow: true, reason: "legacy_account" });
  });

  it("does not block during the grace period", () => {
    expect(evaluateEmailVerificationGate(unverifiedRider, { emailDeliverable: true, now: new Date("2026-08-01T00:00:00Z") }))
      .toMatchObject({ allow: true, reason: "not_mandatory" });
  });
});
