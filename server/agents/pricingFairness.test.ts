import { describe, expect, it, vi } from "vitest";
import { allocateDriverBonus, BONUS_REASON } from "./pricingFairness";
import type { IStorage } from "../storage";

function stubStorage(poolHasMoney: boolean) {
  const calls: string[] = [];
  const storage = {
    tryDeductCommunityBonusPool: vi.fn(async () => { calls.push("pool"); return poolHasMoney; }),
    createBonusAllocation: vi.fn(async (row: any) => { calls.push("row"); return row; }),
    addVirtualCardBalance: vi.fn(async () => { calls.push("wallet"); return {} as any; }),
    createAgentAuditLog: vi.fn(async () => { calls.push("audit"); }),
  };
  return { storage: storage as unknown as IStorage, spies: storage, calls };
}

describe("a community bonus reaches the driver's wallet", () => {
  it("debits the pool, records the allocation and credits the wallet, in that order", async () => {
    const { storage, spies, calls } = stubStorage(true);
    const out = await allocateDriverBonus(storage, "driver-1", 3.5, "undersupply", "ride-1", "Bowie");
    expect(out).toEqual({ allocated: true, amount: 3.5 });
    expect(spies.addVirtualCardBalance).toHaveBeenCalledWith("driver-1", 3.5, BONUS_REASON, "ride-1");
    expect(calls).toEqual(["pool", "row", "wallet", "audit"]);
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
