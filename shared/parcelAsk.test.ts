import { describe, it, expect } from "vitest";
import { isParcelAsk, parcelRefusalText } from "./parcelAsk";

describe("a rider asking to send a parcel", () => {
  it("recognises a parcel ask however it is put", () => {
    for (const t of ["send a package", "Send a package to 123 Main St", "I need a courier", "can you deliver this box to my mom", "parcel pickup", "drop off an envelope at the office", "deliver my groceries", "ship a package"]) {
      expect(isParcelAsk(t), t).toBe(true);
    }
  });
  it("a ride is still a ride", () => {
    for (const t of ["take me home", "Ride to 123 Main St", "drop me off at the mall", "pick me up at 5", "deliver me to the airport", "drive me to Largo", "same as last time", ""]) {
      expect(isParcelAsk(t), t).toBe(false);
    }
  });
  it("one answer everywhere, with the business door", () => {
    expect(parcelRefusalText("https://pgride.app/")).toMatch(/for businesses[\s\S]*https:\/\/pgride\.app\/org\/apply$/);
  });
});
