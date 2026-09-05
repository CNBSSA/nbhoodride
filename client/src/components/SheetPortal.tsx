import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Render a bottom sheet straight into <body>. position:fixed is only
 * viewport-relative when no ancestor establishes a containing block
 * (transforms, filters, overflow+will-change); iOS Safari is stricter about
 * this than Chromium, which is how a sheet can look right on Android and
 * lose its footer below the fold on an iPhone. Portaling removes the
 * question entirely.
 */
export function SheetPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
