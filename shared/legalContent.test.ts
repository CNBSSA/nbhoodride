import { describe, expect, it } from "vitest";
import { LEGAL_PAGES, PRIVACY_SECTIONS, TERMS_SECTIONS } from "./legalContent";

const text = (sections: typeof TERMS_SECTIONS) =>
  sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? []).map((b) => `${b.label ?? ""} ${b.text}`), s.after ?? ""]).join("\n");

describe("legal content", () => {
  it("terms state the cancellation ladder the server actually charges", () => {
    const t = text(TERMS_SECTIONS);
    for (const must of ["free while your request is still waiting", "3 minutes after a driver accepts", "$3.50", "$5.00", "$7.00", "more than 2 hours before departure", "you are never charged"]) {
      expect(t).toContain(must);
    }
  });
  it("terms and privacy both name the operator and how to reach it", () => {
    expect(text(TERMS_SECTIONS)).toContain("Thrynova Insights LLC");
    expect(TERMS_SECTIONS.some((s) => s.contact)).toBe(true);
    expect(PRIVACY_SECTIONS.some((s) => s.contact)).toBe(true);
  });
  it("privacy covers collection, sharing, retention, rights and deletion", () => {
    const headings = PRIVACY_SECTIONS.map((s) => s.heading).join(" | ");
    for (const must of ["Information We Collect", "Data Sharing", "Data Retention", "Your Rights", "Delete Your Account"]) {
      expect(headings).toContain(must);
    }
    expect(text(PRIVACY_SECTIONS)).toContain("We do not sell your personal information");
  });
  it("sections are numbered in order with no gaps", () => {
    for (const page of Object.values(LEGAL_PAGES)) {
      page.sections.forEach((s, i) => expect(s.heading.startsWith(`${i + 1}. `)).toBe(true));
    }
  });
});
