import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { isLocale, t, type Locale, type TranslationKey } from "@shared/i18n";

interface LocaleContextValue {
  locale: Locale;
  translate: (key: TranslationKey) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  translate: (key) => t("en", key),
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Signed out, this is a 401 — and the app-wide 401 handler treats any 401
  // as "your session died" and bounces to /login?expired=1. That is how a
  // visitor opening the portal address or an invitation link landed on the
  // rider login with a "session expired" banner (2026-09-16). A visitor
  // simply reads English.
  const { data: prefs } = useQuery<{ preferredLanguage: string } | null>({
    queryKey: ["/api/user/ride-preferences"],
    queryFn: getQueryFn<{ preferredLanguage: string } | null>({ on401: "returnNull" }),
    retry: false,
  });
  const preferred = prefs?.preferredLanguage ?? "en";
  const locale: Locale = isLocale(preferred) ? preferred : "en";

  const value = useMemo(
    () => ({
      locale,
      translate: (key: TranslationKey) => t(locale, key),
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
