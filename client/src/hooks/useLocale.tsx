import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRidePreferences } from "@/hooks/useRidePreferences";
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
  // simply reads English. The hook shares its cache entry with the Profile
  // screen and hands both of them a whole object, never a null.
  const { preferences } = useRidePreferences();
  const preferred = preferences.preferredLanguage;
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
