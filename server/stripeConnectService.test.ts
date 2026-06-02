// AH-060 Sub-phase A: pin the parameters sent to Stripe for each Connect call.
//
// These wrappers are thin — most of the value of a test here is locking in
// the shape of what we send so a refactor (or an apiVersion bump) can't
// quietly drop `capabilities.transfers`, the `idempotencyKey`, or country=US.
// Anything Stripe is asked to do on a driver's behalf goes through this
// service, so it's a small but high-value chokepoint.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above imports, so the factory can't close over
// module-scoped variables. vi.hoisted runs in the same hoisted phase, which
// is the documented way to share mock objects between the factory and tests.
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    accounts: { create: vi.fn(), retrieve: vi.fn() },
    accountLinks: { create: vi.fn() },
    transfers: { create: vi.fn() },
  },
}));

vi.mock("./stripeService", () => ({
  stripe: stripeMock,
}));

import { StripeConnectService } from "./stripeConnectService";

describe("StripeConnectService", () => {
  let svc: StripeConnectService;

  beforeEach(() => {
    svc = new StripeConnectService();
    stripeMock.accounts.create.mockReset();
    stripeMock.accounts.retrieve.mockReset();
    stripeMock.accountLinks.create.mockReset();
    stripeMock.transfers.create.mockReset();
  });

  describe("createExpressAccount", () => {
    it("creates an Express account with transfers capability and US country", async () => {
      stripeMock.accounts.create.mockResolvedValue({ id: "acct_test_123" });

      await svc.createExpressAccount({
        userId: "user_abc",
        email: "driver@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
      });

      expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1);
      const args = stripeMock.accounts.create.mock.calls[0][0];
      expect(args.type).toBe("express");
      expect(args.country).toBe("US");
      expect(args.email).toBe("driver@example.com");
      expect(args.capabilities.transfers.requested).toBe(true);
      // card_payments MUST NOT be requested — drivers never act as merchant
      // of record on rides, only as payout recipients.
      expect(args.capabilities.card_payments).toBeUndefined();
      expect(args.business_type).toBe("individual");
      expect(args.individual.first_name).toBe("Ada");
      expect(args.individual.last_name).toBe("Lovelace");
      expect(args.metadata.userId).toBe("user_abc");
    });

    it("omits individual block when no name is provided", async () => {
      stripeMock.accounts.create.mockResolvedValue({ id: "acct_test_123" });
      await svc.createExpressAccount({ userId: "u", email: "x@y.com" });
      const args = stripeMock.accounts.create.mock.calls[0][0];
      expect(args.individual).toBeUndefined();
    });
  });

  describe("createAccountLink", () => {
    it("requests onboarding-type link with the refresh and return URLs", async () => {
      stripeMock.accountLinks.create.mockResolvedValue({ url: "https://stripe.test/link" });

      await svc.createAccountLink({
        accountId: "acct_test_123",
        refreshUrl: "https://app.example/connect/refresh",
        returnUrl: "https://app.example/connect/return",
      });

      const args = stripeMock.accountLinks.create.mock.calls[0][0];
      expect(args.account).toBe("acct_test_123");
      expect(args.refresh_url).toBe("https://app.example/connect/refresh");
      expect(args.return_url).toBe("https://app.example/connect/return");
      expect(args.type).toBe("account_onboarding");
    });
  });

  describe("retrieveAccount", () => {
    it("normalises Stripe's account fields to ConnectAccountStatus", async () => {
      stripeMock.accounts.retrieve.mockResolvedValue({
        payouts_enabled: true,
        charges_enabled: false,
        details_submitted: true,
        requirements: { currently_due: ["individual.verification.document"] },
      });

      const status = await svc.retrieveAccount("acct_test_123");
      expect(status.payoutsEnabled).toBe(true);
      expect(status.chargesEnabled).toBe(false);
      expect(status.detailsSubmitted).toBe(true);
      expect(status.requirementsCurrentlyDue).toEqual(["individual.verification.document"]);
    });

    it("defaults requirementsCurrentlyDue to [] when Stripe omits it", async () => {
      stripeMock.accounts.retrieve.mockResolvedValue({
        payouts_enabled: false,
        charges_enabled: false,
        details_submitted: false,
      });
      const status = await svc.retrieveAccount("acct_test_123");
      expect(status.requirementsCurrentlyDue).toEqual([]);
    });
  });

  describe("createTransfer", () => {
    it("passes amount, destination, and metadata; uses idempotencyKey as a request option", async () => {
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_test_1" });

      await svc.createTransfer({
        amountCents: 12345,
        destinationAccountId: "acct_test_123",
        idempotencyKey: "payout_req_abc",
        metadata: { payoutRequestId: "payout_req_abc", driverId: "user_abc" },
        description: "PG Ride payout",
      });

      const [body, opts] = stripeMock.transfers.create.mock.calls[0];
      expect(body.amount).toBe(12345);
      expect(body.currency).toBe("usd");
      expect(body.destination).toBe("acct_test_123");
      expect(body.description).toBe("PG Ride payout");
      expect(body.metadata.payoutRequestId).toBe("payout_req_abc");
      // The idempotency key MUST be on the request options (second arg),
      // not the body — Stripe ignores idempotencyKey in the body and would
      // happily create duplicate transfers on retries.
      expect(opts.idempotencyKey).toBe("payout_req_abc");
    });

    it("defaults metadata to {} when not provided", async () => {
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_test_1" });
      await svc.createTransfer({
        amountCents: 100,
        destinationAccountId: "acct_x",
        idempotencyKey: "k",
      });
      const [body] = stripeMock.transfers.create.mock.calls[0];
      expect(body.metadata).toEqual({});
    });
  });
});
