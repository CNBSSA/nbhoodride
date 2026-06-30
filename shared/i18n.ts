/** E7 — UI strings for English, Spanish, French (PG County demographics). */

export type Locale = "en" | "es" | "fr";

export type TranslationKey =
  | "app.name"
  | "nav.book"
  | "nav.profile"
  | "ride.book"
  | "ride.whereTo"
  | "ride.chooseDriver"
  | "calm.title"
  | "calm.off"
  | "calm.focus"
  | "calm.calm"
  | "calm.social"
  | "calm.family"
  | "language.title"
  | "support.autoResolved";

const en: Record<TranslationKey, string> = {
  "app.name": "PG Ride",
  "nav.book": "Book",
  "nav.profile": "Profile",
  "ride.book": "Book a ride",
  "ride.whereTo": "Where to?",
  "ride.chooseDriver": "Choose your driver",
  "calm.title": "Calm Ride mode",
  "calm.off": "Off",
  "calm.focus": "Focus",
  "calm.calm": "Calm",
  "calm.social": "Social",
  "calm.family": "Family",
  "language.title": "Language",
  "support.autoResolved": "We credited your PG Card — no wait needed.",
};

const es: Record<TranslationKey, string> = {
  "app.name": "PG Ride",
  "nav.book": "Reservar",
  "nav.profile": "Perfil",
  "ride.book": "Reservar un viaje",
  "ride.whereTo": "¿A dónde?",
  "ride.chooseDriver": "Elige tu conductor",
  "calm.title": "Modo viaje tranquilo",
  "calm.off": "Apagado",
  "calm.focus": "Enfoque",
  "calm.calm": "Tranquilo",
  "calm.social": "Social",
  "calm.family": "Familia",
  "language.title": "Idioma",
  "support.autoResolved": "Acreditamos tu tarjeta PG — sin espera.",
};

const fr: Record<TranslationKey, string> = {
  "app.name": "PG Ride",
  "nav.book": "Réserver",
  "nav.profile": "Profil",
  "ride.book": "Réserver une course",
  "ride.whereTo": "Où allez-vous ?",
  "ride.chooseDriver": "Choisissez votre chauffeur",
  "calm.title": "Mode trajet calme",
  "calm.off": "Désactivé",
  "calm.focus": "Concentration",
  "calm.calm": "Calme",
  "calm.social": "Social",
  "calm.family": "Famille",
  "language.title": "Langue",
  "support.autoResolved": "Nous avons crédité votre carte PG — sans attente.",
};

const catalogs: Record<Locale, Record<TranslationKey, string>> = { en, es, fr };

export function t(locale: Locale, key: TranslationKey): string {
  return catalogs[locale]?.[key] ?? catalogs.en[key] ?? key;
}

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "es" || value === "fr";
}

export const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
];
