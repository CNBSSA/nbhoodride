import { describe, expect, it } from "vitest";
import { isLocale, t } from "./i18n";

describe("i18n", () => {
  it("translates core keys in all locales", () => {
    expect(t("en", "ride.book")).toContain("Book");
    expect(t("es", "ride.book")).toContain("Reservar");
    expect(t("fr", "ride.book")).toContain("Réserver");
  });

  it("validates locale codes", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("de")).toBe(false);
  });
});
