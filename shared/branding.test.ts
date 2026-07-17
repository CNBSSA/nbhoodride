import { describe, it, expect } from "vitest";
import { BRAND } from "./branding";

describe("BRAND", () => {
  it("defines PG as People-Governed", () => {
    expect(BRAND.pgMeans).toBe("People-Governed");
    expect(BRAND.appName).toBe("PG Ride");
    expect(BRAND.companyDomain).toBe("peoplegoverned.com");
  });
});
