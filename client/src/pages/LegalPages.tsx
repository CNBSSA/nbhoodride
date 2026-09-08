import { useLocation } from "wouter";
import { ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SupportContactLinks } from "@/components/SupportContactLinks";
import { LEGAL_LAST_UPDATED, LEGAL_PAGES, type LegalPageKind, type LegalSection } from "@shared/legalContent";

// The wording lives in shared/legalContent.ts and is rendered here for the
// app (with a Back button) and by the server as static HTML for visitors
// and reviewers whose browsers do not run JavaScript.

function BackButton() {
  const [, navigate] = useLocation();
  return (
    <Button variant="ghost" size="sm" onClick={() => navigate(-1 as any)} className="mb-4 gap-2">
      <ArrowLeft className="w-4 h-4" />
      Back
    </Button>
  );
}

function Section({ s, muted }: { s: LegalSection; muted: boolean }) {
  const body = muted ? "text-muted-foreground" : "";
  return (
    <section>
      <h2 className="font-semibold text-base mb-2">{s.heading}</h2>
      {s.paragraphs?.map((p, i) => (
        <p key={i} className={body}>{p}</p>
      ))}
      {s.bullets && (
        <ul className={`list-disc list-inside ${s.paragraphs ? "mt-2 " : ""}space-y-1 ${body}`}>
          {s.bullets.map((b, i) => (
            <li key={i}>
              {b.label && <strong className="text-foreground">{b.label}</strong>}{b.label ? " " : ""}{b.text}
            </li>
          ))}
        </ul>
      )}
      {s.after && <p className={`${body} mt-2`}>{s.after}</p>}
      {s.contact && (
        <div className="mt-2">
          <SupportContactLinks className="!justify-start" />
        </div>
      )}
    </section>
  );
}

function LegalPage({ kind }: { kind: LegalPageKind }) {
  const page = LEGAL_PAGES[kind];
  const muted = kind === "privacy";
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <BackButton />
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-7 h-7 text-primary" />
          <h1 className="text-2xl font-bold">{page.title}</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Last updated: {LEGAL_LAST_UPDATED}</p>
        <div className="space-y-6 text-sm leading-relaxed">
          {page.sections.map((s) => (
            <Section key={s.heading} s={s} muted={muted} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function TermsOfService() {
  return <LegalPage kind="terms" />;
}

export function PrivacyPolicy() {
  return <LegalPage kind="privacy" />;
}
