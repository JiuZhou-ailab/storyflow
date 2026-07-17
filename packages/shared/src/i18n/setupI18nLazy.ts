// input: Preferred browser language and optional i18next plugins
// output: Promise for i18next initialized with on-demand locale resources
// pos: Startup-sensitive i18n boundary that avoids bundling every translation

import i18n, { type i18n as I18nInstance, type InitOptions } from "i18next";
import {
  SUPPORTED_LANGUAGE_CODES,
  type LanguageCode,
} from "./languages";

const messageLoaders: Record<LanguageCode, () => Promise<Record<string, string>>> = {
  en: () => import("./locales/en.json").then((module) => module.default),
  es: () => import("./locales/es.json").then((module) => module.default),
  "zh-Hans": () => import("./locales/zh-Hans.json").then((module) => module.default),
  ja: () => import("./locales/ja.json").then((module) => module.default),
  hu: () => import("./locales/hu.json").then((module) => module.default),
  de: () => import("./locales/de.json").then((module) => module.default),
  pl: () => import("./locales/pl.json").then((module) => module.default),
};

let initialization: Promise<I18nInstance> | null = null;
const appliedPlugins = new Set<unknown>();

function resolveLanguage(value: string | null | undefined): LanguageCode | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  const exact = SUPPORTED_LANGUAGE_CODES.find(
    (code) => code.toLowerCase() === normalized,
  );
  if (exact) return exact;
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-Hans";
  return SUPPORTED_LANGUAGE_CODES.find(
    (code) => normalized.startsWith(`${code.toLowerCase()}-`),
  ) ?? null;
}

function detectPreferredLanguage(): LanguageCode {
  const candidates = [
    globalThis.localStorage?.getItem("i18nextLng"),
    ...(globalThis.navigator?.languages ?? []),
    globalThis.navigator?.language,
  ];
  for (const candidate of candidates) {
    const language = resolveLanguage(candidate);
    if (language) return language;
  }
  return "en";
}

const lazyLocaleBackend = {
  type: "backend" as const,
  init() {},
  read(language: string, _namespace: string, callback: (error: Error | null, messages?: Record<string, string>) => void) {
    const supportedLanguage = resolveLanguage(language);
    if (!supportedLanguage) {
      callback(new Error(`Unsupported locale: ${language}`));
      return;
    }
    messageLoaders[supportedLanguage]().then(
      (messages) => callback(null, messages),
      (error) => callback(error instanceof Error ? error : new Error(String(error))),
    );
  },
};

export function setupI18nLazy(plugins: unknown[] = []): Promise<I18nInstance> {
  for (const plugin of plugins) {
    if (appliedPlugins.has(plugin)) continue;
    i18n.use(plugin as Parameters<I18nInstance["use"]>[0]);
    appliedPlugins.add(plugin);
  }
  if (initialization) return initialization;

  i18n.use(lazyLocaleBackend);
  initialization = i18n.init({
    backend: {},
    fallbackLng: "en",
    lng: detectPreferredLanguage(),
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    load: "currentOnly",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  } as InitOptions).then(() => i18n);
  return initialization;
}
