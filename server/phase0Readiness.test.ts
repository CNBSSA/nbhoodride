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

import { pool } from "./db";
import { getPhase0Readiness } from "./phase0Readiness";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ "?column?": 1 }], rowCount: 1 } as never);
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
});
