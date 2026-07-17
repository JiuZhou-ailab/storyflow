// input: Supported product language metadata
// output: Lightweight language codes and labels without translation payloads
// pos: Shared locale catalog used by startup and settings surfaces

export const LANGUAGES = {
  en: { nativeName: "English" },
  es: { nativeName: "Español" },
  "zh-Hans": { nativeName: "简体中文" },
  ja: { nativeName: "日本語" },
  hu: { nativeName: "Magyar" },
  de: { nativeName: "Deutsch" },
  pl: { nativeName: "Polski" },
} as const;

export type LanguageCode = keyof typeof LANGUAGES;

export interface LanguageConfig {
  nativeName: string;
}

/** All supported language codes, derived from lightweight metadata. */
export const SUPPORTED_LANGUAGE_CODES: readonly LanguageCode[] = Object.keys(
  LANGUAGES,
) as LanguageCode[];
