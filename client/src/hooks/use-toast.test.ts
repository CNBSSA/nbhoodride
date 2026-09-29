import { describe, it, expect } from "vitest";
import { reducer } from "./use-toast";

// Product feedback, 2026-09-28: "toasts that vanish". With a limit of one, a
// second message evicted an error message the instant it appeared.
describe("toasts", () => {
  it("keeps three at a time, so a new message does not wipe an error", () => {
    let state = { toasts: [] as any[] };
    for (const id of ["error", "info-1", "info-2"]) {
      state = reducer(state, { type: "ADD_TOAST", toast: { id, open: true, title: id, variant: id === "error" ? "destructive" : "default" } as any });
    }
    expect(state.toasts.map((t) => t.id)).toEqual(["info-2", "info-1", "error"]);
    state = reducer(state, { type: "ADD_TOAST", toast: { id: "info-3", open: true, title: "info-3" } as any });
    expect(state.toasts).toHaveLength(3);
    expect(state.toasts.some((t) => t.id === "info-1")).toBe(true);
  });
});
