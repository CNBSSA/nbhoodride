import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const ENV_KEYS = [
  "PUBLIC_APP_URL",
  "APP_URL",
  "RAILWAY_PUBLIC_DOMAIN",
  "SESSION_SECRET",
  "SUPER_ADMIN_EMAIL",
  "STRIPE_SECRET_KEY",
  "VITE_STRIPE_PUBLIC_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);

vi.mock("./db", () => ({
  pool: {
    query: vi.fn(),
  },
}));

// The map check fetches a real tile in production. Here it is controlled, so
// these tests keep testing readiness logic and not Mapbox's availability.
vi.mock("./mapTiles", () => ({ probeMapTiles: vi.fn() }));

import { pool } from "./db";
import { probeMapTiles } from "./mapTiles";
import { getPhase0Readiness, _resetMapProbeCache } from "./phase0Readiness";

const mockQuery = vi.mocked(pool.query);
const mockMapProbe = vi.mocked(probeMapTiles);

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ "?column?": 1 }], rowCount: 1 } as never);
  // A working map by default; the cases that care set their own.
  _resetMapProbeCache();
  mockMapProbe.mockReset();
  mockMapProbe.mockResolvedValue({ ok: true });
});

afterAll(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("getPhase0Readiness", () => {
  it("reports not ready when database ping fails", async () => {
    process.env.SESSION_SECRET = "secret";
    process.env.PUBLIC_APP_URL = "https://nbhoodride-production.up.railway.app";
    process.env.SUPER_ADMIN_EMAIL = "admin@example.com";
    mockQuery
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ rows: [{ is_super_admin: true, is_admin: true }], rowCount: 1 } as never);

    const report = await getPhase0Readiness();
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === "0.1-database")?.status).toBe("fail");
  });

  it("reports ready when required checks pass on Railway URL", async () => {
    process.env.SESSION_SECRET = "secret";
    process.env.PUBLIC_APP_URL = "https://nbhoodride-production.up.railway.app";
    process.env.SUPER_ADMIN_EMAIL = "admin@example.com";
    mockQuery
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ is_super_admin: true, is_admin: true }], rowCount: 1 } as never);

    const report = await getPhase0Readiness();
    expect(report.ready).toBe(true);
    expect(report.checks.find((c) => c.id === "0.2-public-url")?.status).toBe("warn");
    expect(report.checks.find((c) => c.id === "0.7-domain")?.status).toBe("warn");
  });

  it("passes custom domain checks when PUBLIC_APP_URL uses pgride.com", async () => {
    process.env.SESSION_SECRET = "secret";
    process.env.PUBLIC_APP_URL = "https://pgride.com";
    process.env.SUPER_ADMIN_EMAIL = "admin@example.com";
    mockQuery
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ is_super_admin: true, is_admin: true }], rowCount: 1 } as never);

    const report = await getPhase0Readiness();
    expect(report.ready).toBe(true);
    expect(report.checks.find((c) => c.id === "0.2-public-url")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "0.7-domain")?.status).toBe("pass");
  });

  it("passes custom domain checks when PUBLIC_APP_URL uses peoplegoverned.com", async () => {
    process.env.SESSION_SECRET = "secret";
    process.env.PUBLIC_APP_URL = "https://www.peoplegoverned.com";
    process.env.SUPER_ADMIN_EMAIL = "admin@example.com";
    mockQuery
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ is_super_admin: true, is_admin: true }], rowCount: 1 } as never);

    const report = await getPhase0Readiness();
    expect(report.ready).toBe(true);
    expect(report.checks.find((c) => c.id === "0.2-public-url")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "0.7-domain")?.status).toBe("pass");
  });
});

// 2026-09-13: a deploy whose MAPBOX_TOKEN was rejected blanked every map in
// the app, passed every gate, and was first reported by a rider. Readiness
// covered the database, session secret, email, Twilio, push, Stripe and the
// domain — and not the map.
describe("map tiles are part of being ready", () => {
  const arrangeHealthyExceptMaps = () => {
    process.env.SESSION_SECRET = "secret";
    process.env.PUBLIC_APP_URL = "https://peoplegoverned.com";
    process.env.SUPER_ADMIN_EMAIL = "admin@example.com";
    mockQuery
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ is_super_admin: true, is_admin: true }], rowCount: 1 } as never);
  };

  it("a rejected token fails the check, and is not softened to a warning", async () => {
    arrangeHealthyExceptMaps();
    mockMapProbe.mockResolvedValue({
      ok: false,
      detail: "MAPBOX_TOKEN was rejected — every map in the app is blank (HTTP 401)",
    });

    const report = await getPhase0Readiness();
    const check = report.checks.find((c) => c.id === "0.8-maps");
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("HTTP 401");
  });

  it("and that alone makes the deployment not ready", async () => {
    arrangeHealthyExceptMaps();
    mockMapProbe.mockResolvedValue({ ok: false, detail: "MAPBOX_TOKEN not set" });

    const report = await getPhase0Readiness();
    expect(report.ready).toBe(false);
  });

  it("a working map passes and says a real tile was fetched", async () => {
    arrangeHealthyExceptMaps();

    const report = await getPhase0Readiness();
    const check = report.checks.find((c) => c.id === "0.8-maps");
    expect(check?.status).toBe("pass");
    expect(check?.detail).toContain("real tile");
    expect(report.ready).toBe(true);
  });

  it("does not refetch a tile on every poll", async () => {
    arrangeHealthyExceptMaps();
    await getPhase0Readiness();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ is_super_admin: true, is_admin: true }], rowCount: 1 } as never);
    await getPhase0Readiness();
    expect(mockMapProbe).toHaveBeenCalledTimes(1);
  });
});
