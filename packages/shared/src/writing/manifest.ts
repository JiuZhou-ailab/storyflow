import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type {
  DetectedWritingProject,
  WritingProjectDirectories,
  WritingProjectManifest,
  WritingProjectType,
} from "./types.ts";

const WRITING_MANIFEST_FILENAME = "craft-writing.json";
const SUPPORTED_PROJECT_TYPES = new Set<WritingProjectType>(["novel", "screenplay"]);
const CLAUDE_BOOK_NOVEL_DIRECTORIES = ["bible", "story", "state", "timeline"] as const;

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isSupportedProjectType(value: unknown): value is WritingProjectType {
  return typeof value === "string" && SUPPORTED_PROJECT_TYPES.has(value as WritingProjectType);
}

function parseManifest(rootPath: string): WritingProjectManifest | null {
  const manifestPath = join(rootPath, WRITING_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    if (raw.schemaVersion !== 1) return null;
    if (!isSupportedProjectType(raw.type)) return null;

    return {
      schemaVersion: 1,
      type: raw.type,
      title: typeof raw.title === "string" ? raw.title : undefined,
      language: typeof raw.language === "string" ? raw.language : undefined,
      profile: typeof raw.profile === "string" ? raw.profile : undefined,
    };
  } catch {
    return null;
  }
}

function getDefaultDirectories(rootPath: string): WritingProjectDirectories {
  return {
    bible: join(rootPath, "bible"),
    story: join(rootPath, "story"),
    state: join(rootPath, "state"),
    timeline: join(rootPath, "timeline"),
    analysis: join(rootPath, "analysis"),
    work: join(rootPath, ".work"),
  };
}

function hasClaudeBookNovelStructure(rootPath: string): boolean {
  return CLAUDE_BOOK_NOVEL_DIRECTORIES.every((dir) => isDirectory(join(rootPath, dir)));
}

export function detectWritingProject(rootPath: string): DetectedWritingProject | null {
  const manifest = parseManifest(rootPath);
  if (manifest) {
    return {
      type: manifest.type,
      source: "manifest",
      rootPath,
      manifest,
      directories: getDefaultDirectories(rootPath),
    };
  }

  if (hasClaudeBookNovelStructure(rootPath)) {
    const inferredManifest: WritingProjectManifest = {
      schemaVersion: 1,
      type: "novel",
    };

    return {
      type: "novel",
      source: "structure",
      rootPath,
      manifest: inferredManifest,
      directories: getDefaultDirectories(rootPath),
    };
  }

  return null;
}
