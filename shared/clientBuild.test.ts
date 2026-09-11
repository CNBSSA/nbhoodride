import { describe, expect, it } from "vitest";
import { describeClientBuild } from "./clientBuild";

describe("telling a stale phone from a real regression", () => {
  it("says nothing is wrong when the phone is on the deployed build", () => {
    const v = describeClientBuild("abc123", "abc123");
    expect(v.stale).toBe(false);
    expect(v.text).toContain("current");
    expect(v.keyPart).toBe("");
  });

  it("names both builds when the phone is behind", () => {
    const v = describeClientBuild("old111", "new222");
    expect(v.stale).toBe(true);
    expect(v.text).toContain("OUT OF DATE");
    expect(v.text).toContain("new222");
  });

  it("treats a bundle too old to report its build as out of date", () => {
    const v = describeClientBuild(undefined, "new222");
    expect(v.stale).toBe(true);
    expect(v.keyPart).toBe("build:unknown");
  });

  it("de-duplicates a stale build by the build, so one alert covers every phone on it", () => {
    expect(describeClientBuild("old111", "new222").keyPart).toBe("build:old111");
    // Same old build, different riders → same key → one alert.
    expect(describeClientBuild("old111", "new222").keyPart)
      .toBe(describeClientBuild("old111", "new222").keyPart);
  });

  it("keeps a current-build crash keyed per rider, because that one is news", () => {
    expect(describeClientBuild("abc123", "abc123").keyPart).toBe("");
  });

  it("does not accuse a phone when the server does not know its own build", () => {
    expect(describeClientBuild("abc123", "dev").stale).toBe(false);
    expect(describeClientBuild("abc123", "").stale).toBe(false);
    expect(describeClientBuild("abc123", "dev").text).toContain("server build unknown");
  });
});
