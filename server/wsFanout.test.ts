import { describe, it, expect, vi } from "vitest";
import { UserSockets, socketsFor } from "./wsFanout";

const fake = (readyState = 1) => ({ readyState, send: vi.fn(), close: vi.fn() }) as any;

describe("one person, every open tab", () => {
  it("sends to every open socket and reads as open while any is", () => {
    const u = new UserSockets();
    const a = fake(1), b = fake(1), c = fake(3);
    u.add(a); u.add(b); u.add(c);
    expect(u.readyState).toBe(1);
    u.send("hello");
    expect(a.send).toHaveBeenCalledWith("hello");
    expect(b.send).toHaveBeenCalledWith("hello");
    expect(c.send).not.toHaveBeenCalled();
  });
  it("reads as closed once the last open socket is gone", () => {
    const u = new UserSockets();
    const a = fake(1);
    u.add(a);
    expect(u.readyState).toBe(1);
    u.delete(a);
    expect(u.size).toBe(0);
    expect(u.readyState).toBe(3);
  });
  it("drops a socket that throws on send and keeps the others", () => {
    const u = new UserSockets();
    const bad = { readyState: 1, send: vi.fn(() => { throw new Error("EPIPE"); }) } as any;
    const good = fake(1);
    u.add(bad); u.add(good);
    u.send("x");
    expect(good.send).toHaveBeenCalledTimes(1);
    expect(u.has(bad)).toBe(false);
  });
  it("is created on first join and reused after", () => {
    const map = new Map<string, UserSockets>();
    const first = socketsFor(map, "u1"); first.add(fake());
    const again = socketsFor(map, "u1"); again.add(fake());
    expect(again).toBe(first);
    expect(first.size).toBe(2);
  });
});
