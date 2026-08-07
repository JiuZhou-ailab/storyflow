// input: The selected Storyflow language and the process-wide i18n state
// output: Localized rules for assistant replies and human-visible artifacts
// pos: Shared language contract consumed by prompts, titles, and workflows

import { i18n } from './setupI18n';
import { LANGUAGES, SUPPORTED_LANGUAGE_CODES, type LanguageCode } from './languages';

interface LanguagePolicyCopy {
  heading: string;
  selectedLanguage: (languageName: string, languageCode: LanguageCode) => string;
  reply: string;
  artifacts: string;
  precedence: string;
  machineContract: string;
}

const LANGUAGE_ALIASES: Record<string, LanguageCode> = {
  chinese: 'zh-Hans',
  'simplified chinese': 'zh-Hans',
  deutsch: 'de',
  german: 'de',
  english: 'en',
  español: 'es',
  spanish: 'es',
  magyar: 'hu',
  hungarian: 'hu',
  japanese: 'ja',
  日本語: 'ja',
  polish: 'pl',
  polski: 'pl',
};

const LANGUAGE_POLICY_COPY: Record<LanguageCode, LanguagePolicyCopy> = {
  en: {
    heading: 'User Language and Human-Visible Naming',
    selectedLanguage: (name, code) => `The selected user language is ${name} (code: ${code}).`,
    reply: 'Reply in English by default, including explanations, titles, status messages, errors, and newly authored content.',
    artifacts: 'When creating or renaming user-visible files, folders, document headings, or project entries, use clear human-readable English names by default.',
    precedence: 'An explicit user language or naming request wins. Preserve existing names, source text, code, commands, file extensions, paths, API/protocol identifiers, and machine-readable IDs unless the user explicitly asks to change them.',
    machineContract: 'Keep runtime-constrained Skill slugs, Skill folder names, frontmatter `name`, JSON/YAML keys, scripts, and command paths in their required existing format (normally ASCII kebab-case). Localize Skill display names, descriptions, instructions, examples, and generated human-facing content.',
  },
  es: {
    heading: 'Idioma del usuario y nombres visibles para las personas',
    selectedLanguage: (name, code) => `El idioma seleccionado por el usuario es ${name} (código: ${code}).`,
    reply: 'Responde por defecto en español, incluidas las explicaciones, los títulos, los estados, los errores y el contenido nuevo.',
    artifacts: 'Al crear o cambiar el nombre de archivos, carpetas, títulos de documentos o elementos del proyecto visibles para el usuario, usa por defecto nombres claros en español.',
    precedence: 'Una petición explícita del usuario sobre el idioma o el nombre tiene prioridad. Conserva los nombres existentes, el texto fuente, el código, los comandos, las extensiones, las rutas, los identificadores de API/protocolo y los ID legibles por máquinas salvo que el usuario pida cambiarlos.',
    machineContract: 'Conserva el formato requerido por el runtime para los slugs de Skills, las carpetas de Skills, `name` del frontmatter, las claves JSON/YAML, los scripts y las rutas de comandos (normalmente ASCII kebab-case). Localiza los nombres visibles, las descripciones, las instrucciones, los ejemplos y el contenido dirigido a personas de los Skills.',
  },
  'zh-Hans': {
    heading: '用户语言与可见名称规则',
    selectedLanguage: (name, code) => `当前选定的用户语言是${name}（代码：${code}）。`,
    reply: '默认使用简体中文回答，包括解释、标题、状态、错误说明和新创作的内容。',
    artifacts: '创建或重命名用户可见的文件、文件夹、文档标题和项目条目时，优先使用清晰的简体中文名称。',
    precedence: '用户明确指定语言或名称时，以用户指示为准。除非用户明确要求，否则保留已有名称、原文内容、代码、命令、扩展名、路径、API/协议标识符和机器可读 ID。',
    machineContract: 'Skill 的 slug、Skill 目录名、frontmatter 的 `name`、JSON/YAML key、脚本和命令中的路径属于运行时契约，保持既有格式（通常是 ASCII kebab-case）。Skill 的 displayName、description、说明、示例和面向用户的生成内容遵循当前语言。',
  },
  ja: {
    heading: 'ユーザー言語と人間向けの名前',
    selectedLanguage: (name, code) => `選択されているユーザー言語は${name}（コード: ${code}）です。`,
    reply: '説明、タイトル、状態、エラー、新しく作成する内容を含め、既定では日本語で回答してください。',
    artifacts: 'ユーザーに見えるファイル、フォルダー、文書見出し、プロジェクト項目を作成または改名するときは、明確な日本語の名前を既定で使用してください。',
    precedence: 'ユーザーが明示した言語または名前の指定を優先してください。明示的な変更依頼がない限り、既存の名前、原文、コード、コマンド、拡張子、パス、API/プロトコル識別子、機械可読 ID は保持してください。',
    machineContract: 'Skill の slug、Skill フォルダー名、frontmatter の `name`、JSON/YAML キー、スクリプト、コマンドパスなど、runtime が要求する形式（通常は ASCII kebab-case）を維持してください。Skill の表示名、説明、手順、例、人間向けの生成内容は現在の言語にしてください。',
  },
  hu: {
    heading: 'A felhasználó nyelve és az ember által olvasható elnevezések',
    selectedLanguage: (name, code) => `A kiválasztott felhasználói nyelv: ${name} (kód: ${code}).`,
    reply: 'Alapértelmezés szerint magyarul válaszolj, beleértve a magyarázatokat, címeket, állapotokat, hibaüzeneteket és az új tartalmat.',
    artifacts: 'Felhasználó által látható fájlok, mappák, dokumentumcímek vagy projekttételek létrehozásakor és átnevezésekor alapértelmezés szerint világos magyar neveket használj.',
    precedence: 'A felhasználó kifejezett nyelvi vagy elnevezési kérése elsőbbséget élvez. Kérés nélkül őrizd meg a meglévő neveket, forrásszöveget, kódot, parancsokat, kiterjesztéseket, útvonalakat, API-/protokollazonosítókat és gépi ID-kat.',
    machineContract: 'Tartsd meg a runtime által megkövetelt Skill slugokat, Skill-mappaneveket, a frontmatter `name` mezőjét, a JSON/YAML-kulcsokat, a scripteket és a parancsútvonalakat (általában ASCII kebab-case). A Skill látható neveit, leírásait, utasításait, példáit és embernek szánt tartalmát lokalizáld.',
  },
  de: {
    heading: 'Benutzersprache und menschenlesbare Namen',
    selectedLanguage: (name, code) => `Die ausgewählte Benutzersprache ist ${name} (Code: ${code}).`,
    reply: 'Antworte standardmäßig auf Deutsch, einschließlich Erklärungen, Titeln, Statusmeldungen, Fehlern und neu erstellten Inhalten.',
    artifacts: 'Verwende beim Erstellen oder Umbenennen sichtbarer Dateien, Ordner, Dokumentüberschriften oder Projektelemente standardmäßig klare deutsche Namen.',
    precedence: 'Eine ausdrückliche Sprach- oder Namensvorgabe des Benutzers hat Vorrang. Bestehende Namen, Quelltext, Code, Befehle, Dateiendungen, Pfade, API-/Protokollbezeichner und maschinenlesbare IDs bleiben unverändert, sofern der Benutzer keine Änderung verlangt.',
    machineContract: 'Behalte die vom Runtime-Vertrag vorgegebenen Skill-Slugs, Skill-Ordnernamen, den Frontmatter-Schlüssel `name`, JSON-/YAML-Schlüssel, Skripte und Befehlspfade bei (normalerweise ASCII kebab-case). Skill-Anzeigenamen, Beschreibungen, Anweisungen, Beispiele und menschenlesbare Inhalte werden lokalisiert.',
  },
  pl: {
    heading: 'Język użytkownika i nazwy widoczne dla człowieka',
    selectedLanguage: (name, code) => `Wybrany język użytkownika to ${name} (kod: ${code}).`,
    reply: 'Domyślnie odpowiadaj po polsku, w tym w objaśnieniach, tytułach, statusach, błędach i nowo tworzonych treściach.',
    artifacts: 'Podczas tworzenia lub zmiany nazw widocznych dla użytkownika plików, folderów, nagłówków dokumentów i elementów projektu używaj domyślnie jasnych polskich nazw.',
    precedence: 'Jawna prośba użytkownika dotycząca języka lub nazwy ma pierwszeństwo. Bez takiej prośby zachowuj istniejące nazwy, tekst źródłowy, kod, polecenia, rozszerzenia, ścieżki, identyfikatory API/protokołów i ID maszynowe.',
    machineContract: 'Zachowuj wymagany przez runtime format slugów Skills, nazw folderów Skills, pola `name` w frontmatter, kluczy JSON/YAML, skryptów i ścieżek poleceń (zwykle ASCII kebab-case). Lokalizuj wyświetlane nazwy, opisy, instrukcje, przykłady i treści przeznaczone dla ludzi.',
  },
};

/** Resolve a locale tag or common language name to a supported product language. */
export function resolveLanguageCode(value?: string | null): LanguageCode {
  if (!value) return 'en';

  const normalized = value.trim().toLowerCase();
  const exact = SUPPORTED_LANGUAGE_CODES.find((code) => code.toLowerCase() === normalized);
  if (exact) return exact;

  const byAlias = LANGUAGE_ALIASES[normalized];
  if (byAlias) return byAlias;

  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-Hans';
  return SUPPORTED_LANGUAGE_CODES.find((code) => normalized.startsWith(`${code.toLowerCase()}-`)) ?? 'en';
}

/** Return the language currently selected in the process-wide i18n instance. */
export function getCurrentLanguageCode(): LanguageCode {
  return resolveLanguageCode(i18n.resolvedLanguage ?? i18n.language);
}

/** Return the native display name for a locale tag or supported language name. */
export function getLanguageNativeName(language?: string | null): string {
  return LANGUAGES[resolveLanguageCode(language)].nativeName;
}

/** Return the selected language name for title generation and other small prompts. */
export function getCurrentLanguageName(): string {
  return getLanguageNativeName(getCurrentLanguageCode());
}

/**
 * Format the shared language contract. Keep machine identifiers separate from
 * human-facing names so localization never breaks runtime paths or schemas.
 */
export function formatLanguagePolicyForPrompt(language?: string | null): string {
  const code = resolveLanguageCode(language ?? getCurrentLanguageCode());
  const name = LANGUAGES[code].nativeName;
  const copy = LANGUAGE_POLICY_COPY[code];

  return [
    `## ${copy.heading}`,
    '',
    `- ${copy.selectedLanguage(name, code)}`,
    `- ${copy.reply}`,
    `- ${copy.artifacts}`,
    `- ${copy.precedence}`,
    `- ${copy.machineContract}`,
  ].join('\n');
}

/**
 * A short reminder placed at the dynamic tail, after provider-native Skills,
 * so a late-loaded Skill cannot accidentally switch human-facing output back
 * to English.
 */
export function formatLanguageReminderForPrompt(language?: string | null): string {
  const code = resolveLanguageCode(language ?? getCurrentLanguageCode());
  const name = LANGUAGES[code].nativeName;
  const reminders: Record<LanguageCode, string> = {
    en: `Language reminder: reply in ${name} and use ${name} for new human-visible file and folder names, except for explicit user requests and runtime identifiers.`,
    es: `Recordatorio de idioma: responde en ${name} y usa ${name} para los nombres nuevos de archivos y carpetas visibles, salvo peticiones explícitas e identificadores del runtime.`,
    'zh-Hans': `语言提醒：使用${name}回答，并使用${name}命名新建的用户可见文件和文件夹；用户明确要求及运行时标识符除外。`,
    ja: `言語リマインダー: ${name}で回答し、新しく作る人間向けのファイル名とフォルダー名にも${name}を使用してください。明示的な依頼とruntime識別子は除きます。`,
    hu: `Nyelvi emlékeztető: ${name} nyelven válaszolj, és az új, felhasználó által látható fájl- és mappanevekhez is ${name} nyelvet használj, a kifejezett kérések és runtime-azonosítók kivételével.`,
    de: `Spracherinnerung: Antworte auf ${name} und verwende ${name} für neue sichtbare Datei- und Ordnernamen, außer bei ausdrücklichen Vorgaben und Runtime-Bezeichnern.`,
    pl: `Przypomnienie językowe: odpowiadaj po ${name} i używaj ${name} w nowych nazwach widocznych plików i folderów, z wyjątkiem jawnych próśb i identyfikatorów runtime.`,
  };

  return `<language_policy_reminder>\n${reminders[code]}\n</language_policy_reminder>`;
}
