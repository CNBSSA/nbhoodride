import { afterEach, describe, expect, it } from "vitest";
import { formatOpsAlert, telegramOpsEnabled } from "./telegramOps";

const ENV_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;
const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("telegramOpsEnabled", () => {
  it("is disabled unless both token and chat id are set", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    expect(telegramOpsEnabled()).toBe(false);
    process.env.TELEGRAM_BOT_TOKEN = "t";
    expect(telegramOpsEnabled()).toBe(false);
    process.env.TELEGRAM_CHAT_ID = "c";
    expect(telegramOpsEnabled()).toBe(true);
  });

  it("treats whitespace-only values as unset", () => {
    process.env.TELEGRAM_BOT_TOKEN = "  ";
    process.env.TELEGRAM_CHAT_ID = "c";
    expect(telegramOpsEnabled()).toBe(false);
  });
});

describe("formatOpsAlert", () => {
  it("renders title plus label lines", () => {
    expect(
      formatOpsAlert("🚗 New ride booked", [
        ["Rider", "Ada L."],
        ["Fare", "$18.40"],
      ]),
    ).toBe("🚗 New ride booked\nRider: Ada L.\nFare: $18.40");
  });

  it("skips empty, null, and undefined values", () => {
    expect(
      formatOpsAlert("🚨 SOS", [
        ["Rider", null],
        ["Phone", undefined],
        ["Map", ""],
        ["Type", "sos"],
      ]),
    ).toBe("🚨 SOS\nType: sos");
  });

  it("stringifies numbers", () => {
    expect(formatOpsAlert("T", [["Stops", 3]])).toBe("T\nStops: 3");
  });
});
