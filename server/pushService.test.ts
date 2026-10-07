import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMock, recordMock } = vi.hoisted(() => ({ sendMock: vi.fn(), recordMock: vi.fn(async () => {}) }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: sendMock }, setVapidDetails: vi.fn(), sendNotification: sendMock }));
vi.mock("./reliabilityEvents", () => ({ recordReliabilityEvent: recordMock }));

process.env.VAPID_PUBLIC_KEY = "BPU1o4kDidRblKoSdSvpjUTYivyMlA8KvUJjV0ORIqM8oaYa46ZtaYQqk6bJq1I0FeGMLmL1o6NBjgVyCmUlVAY";
process.env.VAPID_PRIVATE_KEY = "T9dIq6-7n8w4dGz5v0K5X6H7f5y8Yt0oJ0r1c8kZ1sU";

const { sendPushNotification, sendPushToSubscriptions } = await import("./pushService");
const flush = () => new Promise((r) => setTimeout(r, 0));
const sub = { endpoint: "https://push.example/abc", p256dh: "k", auth: "a" };

// Reliability audit 2026-09-29: a pruned subscription and a send error used
// to leave no trace, so nobody could say how many riders a push never reached.
describe("a push that could not be delivered", () => {
  beforeEach(() => { sendMock.mockReset(); recordMock.mockClear(); });

  it("records a pruned subscription", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));
    const ok = await sendPushNotification(sub, { title: "t", body: "b", tag: "ride-cancelled" });
    await flush();
    expect(ok).toBe(false);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "push_pruned", page: "ride-cancelled" }));
  });

  it("records a send error with its status", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("Server error"), { statusCode: 500 }));
    const ok = await sendPushNotification(sub, { title: "t", body: "b", tag: "driver-arrived" });
    await flush();
    expect(ok).toBe(false);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "push_failed", page: "driver-arrived", message: expect.stringContaining("500") }));
  });

  it("records nothing when the push went out", async () => {
    sendMock.mockResolvedValueOnce({});
    const ok = await sendPushNotification(sub, { title: "t", body: "b" });
    await flush();
    expect(ok).toBe(true);
    expect(recordMock).not.toHaveBeenCalled();
  });
});

// Code review 2026-10-06: every failure used to count as "expired", so a
// passing 5xx deleted the rider's subscription for good.
describe("which subscriptions are removed", () => {
  beforeEach(() => { sendMock.mockReset(); recordMock.mockClear(); });

  it("removes one the push service says is gone", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));
    const removed: string[] = [];
    await sendPushToSubscriptions([sub], { title: "t", body: "b" }, (ep) => removed.push(ep));
    expect(removed).toEqual([sub.endpoint]);
  });

  it("keeps one that failed for any other reason", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("Server error"), { statusCode: 503 }));
    sendMock.mockRejectedValueOnce(new Error("socket hang up"));
    const removed: string[] = [];
    await sendPushToSubscriptions([sub, { ...sub, endpoint: "https://push.example/def" }], { title: "t", body: "b" }, (ep) => removed.push(ep));
    expect(removed).toEqual([]);
  });

  it("sends with a timeout, so a stalled push service cannot hold a send open", async () => {
    sendMock.mockResolvedValueOnce({});
    await sendPushNotification(sub, { title: "t", body: "b" });
    expect(sendMock).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ timeout: 10_000 }));
  });
});
