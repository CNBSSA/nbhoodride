import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
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
  const { data: prefs } = useQuery<{ preferredLanguage: string }>({
    queryKey: ["/api/user/ride-preferences"],
    retry: false,
  });
  const locale: Locale = isLocale(prefs?.preferredLanguage ?? "en")
    ? (prefs!.preferredLanguage as Locale)
    : "en";

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
