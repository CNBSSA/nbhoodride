import { Mail, MessageSquare, Phone } from "lucide-react";
import { SUPPORT } from "@shared/userFacingCopy";

interface SupportContactLinksProps {
  /** "pills" = three tappable icon buttons (Email / Text / Call). "prose" = one sentence with inline links, for legal/body copy. */
  variant?: "pills" | "prose";
  className?: string;
}

/**
 * Canonical support-contact display. Every channel (email, SMS, call) comes
 * from shared/supportContacts.ts via SUPPORT — change the number or address
 * once there and it updates everywhere this component is used.
 */
export function SupportContactLinks({ variant = "pills", className = "" }: SupportContactLinksProps) {
  if (variant === "prose") {
    return (
      <p className={`text-sm text-muted-foreground ${className}`} data-testid="support-contact-prose">
        {SUPPORT.channelsNote}{" "}
        <a className="text-primary underline" href={`mailto:${SUPPORT.email}`}>
          {SUPPORT.email}
        </a>
        {" or call/text "}
        <a className="text-primary underline" href={`tel:${SUPPORT.phoneTel}`}>
          {SUPPORT.phoneDisplay}
        </a>
        .
      </p>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-2 ${className}`}
      data-testid="support-contact-links"
    >
      <a
        href={`mailto:${SUPPORT.email}`}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary transition-colors"
        data-testid="link-support-email"
      >
        <Mail className="w-3.5 h-3.5" /> Email
      </a>
      <a
        href={SUPPORT.phoneSms}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary transition-colors"
        data-testid="link-support-sms"
      >
        <MessageSquare className="w-3.5 h-3.5" /> Text
      </a>
      <a
        href={`tel:${SUPPORT.phoneTel}`}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary transition-colors"
        data-testid="link-support-call"
      >
        <Phone className="w-3.5 h-3.5" /> Call
      </a>
    </div>
  );
}
