import { describe, expect, it, vi } from "vitest";
import { allocateDriverBonus, BONUS_REASON } from "./pricingFairness";
import type { IStorage } from "../storage";

function stubStorage(poolHasMoney: boolean) {
  const calls: string[] = [];
  const storage = {
    tryDeductCommunityBonusPool: vi.fn(async () => { calls.push("pool"); return poolHasMoney; }),
    createBonusAllocation: vi.fn(async (row: any) => { calls.push("row"); return row; }),
    addVirtualCardBalance: vi.fn(async () => { calls.push("wallet"); return {} as any; }),
    fundCommunityBonusPool: vi.fn(async () => { calls.push("refund"); return {} as any; }),
    createAgentAuditLog: vi.fn(async () => { calls.push("audit"); }),
  };
  return { storage: storage as unknown as IStorage, spies: storage, calls };
}

describe("a community bonus reaches the driver's wallet", () => {
  it("debits the pool, credits the wallet, then records the allocation", async () => {
    const { storage, spies, calls } = stubStorage(true);
    const out = await allocateDriverBonus(storage, "driver-1", 3.5, "undersupply", "ride-1", "Bowie");
    expect(out).toEqual({ allocated: true, amount: 3.5 });
    expect(spies.addVirtualCardBalance).toHaveBeenCalledWith("driver-1", 3.5, BONUS_REASON, "ride-1");
    expect(calls).toEqual(["pool", "wallet", "row", "audit"]);
  });

  it("gives the pool its money back when the wallet cannot be credited, and records nothing", async () => {
    const { storage, spies, calls } = stubStorage(true);
    spies.addVirtualCardBalance.mockRejectedValueOnce(new Error("User not found"));
    await expect(allocateDriverBonus(storage, "nobody", 3.5, "undersupply")).rejects.toThrow("User not found");
    expect(spies.fundCommunityBonusPool).toHaveBeenCalledWith(3.5);
    expect(spies.createBonusAllocation).not.toHaveBeenCalled();
    expect(calls).toEqual(["pool", "refund"]);
  });

  it("credits nothing when the pool cannot fund it", async () => {
    const { storage, spies } = stubStorage(false);
    const out = await allocateDriverBonus(storage, "driver-1", 3.5, "undersupply");
    expect(out.allocated).toBe(false);
    expect(spies.addVirtualCardBalance).not.toHaveBeenCalled();
    expect(spies.createBonusAllocation).not.toHaveBeenCalled();
  });

  it("refuses a zero or negative bonus without touching anything", async () => {
    const { storage, spies } = stubStorage(true);
    expect(await allocateDriverBonus(storage, "driver-1", 0, "x")).toEqual({ allocated: false, amount: 0 });
    expect(spies.tryDeductCommunityBonusPool).not.toHaveBeenCalled();
  });
});
