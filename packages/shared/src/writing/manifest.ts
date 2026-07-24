import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { getExistingWorkspaceWritingManifestPath } from "../workspaces/paths.ts";
import type {
  DetectedWritingProject,
  WritingProjectDirectories,
  WritingProjectManifest,
  WritingProjectType,
} from "./types.ts";

const SUPPORTED_PROJECT_TYPES = new Set<WritingProjectType>(["novel", "screenplay", "short-form"]);
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
  const manifestPath = getExistingWorkspaceWritingManifestPath(rootPath);
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    if (raw.schemaVersion !== 1) return null;
    if (!isSupportedProjectType(raw.type)) return null;

    return {
      schemaVersion: 1,
      type: raw.type,
      ...(typeof raw.title === "string" ? { title: raw.title } : {}),
      ...(typeof raw.language === "string" ? { language: raw.language } : {}),
      ...(typeof raw.profile === "string" ? { profile: raw.profile } : {}),
      ...(typeof raw.storageProfile === "string" ? { storageProfile: raw.storageProfile } : {}),
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
    brief: join(rootPath, "brief"),
    notes: join(rootPath, "notes"),
    style: join(rootPath, "style"),
    drafts: join(rootPath, "drafts"),
    revisions: join(rootPath, "revisions"),
    published: join(rootPath, "published"),
    reviews: join(rootPath, "reviews"),
  };
}

function hasClaudeBookNovelStructure(rootPath: string): boolean {
  return CLAUDE_BOOK_NOVEL_DIRECTORIES.every((dir) => isDirectory(join(rootPath, dir)));
}

export function detectWritingProject(rootPath: string): DetectedWritingProject | null {
  const manifestProject = detectManifestWritingProject(rootPath);
  if (manifestProject) return manifestProject;

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

export function detectManifestWritingProject(rootPath: string): DetectedWritingProject | null {
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

  return null;
}
