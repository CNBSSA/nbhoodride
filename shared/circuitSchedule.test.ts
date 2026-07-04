import { describe, it, expect } from "vitest";
import { describeCircuitSchedule, nextRunAt, cutoffFor } from "./circuitSchedule";

describe("describeCircuitSchedule", () => {
  it("formats a morning run", () => {
    expect(describeCircuitSchedule({ dayOfWeek: 0, departureHour: 9, departureMinute: 0 })).toBe(
      "Sundays · 9:00 AM",
    );
  });

  it("formats early-morning warehouse runs", () => {
    expect(describeCircuitSchedule({ dayOfWeek: 1, departureHour: 4, departureMinute: 30 })).toBe(
      "Mondays · 4:30 AM",
    );
  });

  it("handles noon and midnight 12-hour edges", () => {
    expect(describeCircuitSchedule({ dayOfWeek: 6, departureHour: 12, departureMinute: 15 })).toBe(
      "Saturdays · 12:15 PM",
    );
    expect(describeCircuitSchedule({ dayOfWeek: 3, departureHour: 0, departureMinute: 5 })).toBe(
      "Wednesdays · 12:05 AM",
    );
  });
});

describe("nextRunAt", () => {
  // Wed Jan 7 2026, 10:00:00 local
  const wed10am = new Date(2026, 0, 7, 10, 0, 0, 0);

  it("finds the next occurrence later this week", () => {
    const run = nextRunAt({ dayOfWeek: 5, departureHour: 8, departureMinute: 0 }, wed10am);
    expect(run.getDay()).toBe(5);
    expect(run.getDate()).toBe(9); // Fri Jan 9
    expect(run.getHours()).toBe(8);
  });

  it("wraps to next week when the day already passed", () => {
    const run = nextRunAt({ dayOfWeek: 1, departureHour: 8, departureMinute: 0 }, wed10am);
    expect(run.getDay()).toBe(1);
    expect(run.getDate()).toBe(12); // Mon Jan 12
  });

  it("same day, later time → today", () => {
    const run = nextRunAt({ dayOfWeek: 3, departureHour: 18, departureMinute: 30 }, wed10am);
    expect(run.getDate()).toBe(7);
    expect(run.getHours()).toBe(18);
    expect(run.getMinutes()).toBe(30);
  });

  it("same day, earlier time → next week", () => {
    const run = nextRunAt({ dayOfWeek: 3, departureHour: 9, departureMinute: 0 }, wed10am);
    expect(run.getDate()).toBe(14); // Wed Jan 14
  });

  it("exactly at departure instant → next week, not now", () => {
    const atDeparture = new Date(2026, 0, 7, 10, 0, 0, 0);
    const run = nextRunAt({ dayOfWeek: 3, departureHour: 10, departureMinute: 0 }, atDeparture);
    expect(run.getDate()).toBe(14);
  });
});

describe("cutoffFor", () => {
  it("subtracts the cutoff hours", () => {
    const run = new Date(2026, 0, 11, 9, 0, 0, 0); // Sun 9am
    const cutoff = cutoffFor(run, 12);
    expect(cutoff.getDate()).toBe(10); // Sat
    expect(cutoff.getHours()).toBe(21); // 9pm
  });

  it("zero cutoff means booking until departure", () => {
    const run = new Date(2026, 0, 11, 9, 0, 0, 0);
    expect(cutoffFor(run, 0).getTime()).toBe(run.getTime());
  });
});
