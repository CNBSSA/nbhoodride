import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resolveAppUrl } from "./appUrl";

const ENV_KEYS = ["PUBLIC_APP_URL", "APP_URL", "RAILWAY_PUBLIC_DOMAIN"] as const;
const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

afterAll(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("resolveAppUrl", () => {
  it("adds https:// when the value was entered without a scheme", () => {
    process.env.PUBLIC_APP_URL = "nbhoodride-production.up.railway.app";
    expect(resolveAppUrl()).toBe("https://nbhoodride-production.up.railway.app");
  });

  it("keeps an explicit scheme", () => {
    process.env.PUBLIC_APP_URL = "https://pgride.com";
    expect(resolveAppUrl()).toBe("https://pgride.com");
  });

  it("strips trailing slashes", () => {
    process.env.PUBLIC_APP_URL = "https://pgride.com/";
    expect(resolveAppUrl()).toBe("https://pgride.com");
  });

  it("trims whitespace from copy-pasted values", () => {
    process.env.PUBLIC_APP_URL = " pgride.com ";
    expect(resolveAppUrl()).toBe("https://pgride.com");
  });

  it("prefers PUBLIC_APP_URL over APP_URL over RAILWAY_PUBLIC_DOMAIN", () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = "auto.up.railway.app";
    expect(resolveAppUrl()).toBe("https://auto.up.railway.app");
    process.env.APP_URL = "https://app-url.example";
    expect(resolveAppUrl()).toBe("https://app-url.example");
    process.env.PUBLIC_APP_URL = "https://public.example";
    expect(resolveAppUrl()).toBe("https://public.example");
  });

  it("uses the fallback when nothing is set, normalized the same way", () => {
    expect(resolveAppUrl("https://host.from.request/")).toBe("https://host.from.request");
    expect(resolveAppUrl()).toBe("");
  });
});
