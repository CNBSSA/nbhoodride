import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/reportClientError", () => ({ reportClientError: vi.fn() }));
vi.stubEnv("VITE_STRIPE_PUBLIC_KEY", "pk_test_unit");

const { _resetStripeLoader, getStripe, STRIPE_PUBLISHABLE_KEY } = await import("./stripeLoader");
const { reportClientError } = await import("@/lib/reportClientError");

describe("getStripe", () => {
  beforeEach(() => { _resetStripeLoader(); vi.mocked(reportClientError).mockClear(); });

  it("loads once and shares the result", async () => {
    const loader = vi.fn(async () => ({ id: "stripe" }) as any);
    const a = getStripe(loader);
    const b = getStripe(loader);
    expect(await a).toBe(await b);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(STRIPE_PUBLISHABLE_KEY);
  });

  it("a failed download is reported in words and the next call really retries", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("Failed to load Stripe.js"))
      .mockResolvedValueOnce({ id: "stripe" } as any);
    await expect(getStripe(loader)).rejects.toThrow("Failed to load Stripe.js");
    expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportClientError).mock.calls[0][0].message).toContain("Stripe.js could not be downloaded (blocked or offline)");
    expect(await getStripe(loader)).toEqual({ id: "stripe" });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
