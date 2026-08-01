import { describe, expect, it, beforeEach } from "vitest";
import {
  INSTALL_GATE_SESSION_KEY,
  captureInstallGateFromUrl,
  isInstallGateRequired,
  clearInstallGateRequirement,
  isPublicInstallExemptPath,
  shouldShowInstallGate,
} from "./pwaInstall";

describe("pwaInstall QR gate", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("captures qr=1 in session", () => {
    expect(captureInstallGateFromUrl("?qr=1")).toBe(true);
    expect(isInstallGateRequired()).toBe(true);
  });

  it("exempts guardian links", () => {
    captureInstallGateFromUrl("?qr=1");
    expect(isPublicInstallExemptPath("/guardian/abc")).toBe(true);
    expect(shouldShowInstallGate("/guardian/abc")).toBe(false);
  });

  it("clears requirement helper", () => {
    sessionStorage.setItem(INSTALL_GATE_SESSION_KEY, "1");
    clearInstallGateRequirement();
    expect(isInstallGateRequired()).toBe(false);
  });
});
