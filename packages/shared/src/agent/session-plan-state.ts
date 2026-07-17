// input: Session identifiers, project paths, and submitted plan paths
// output: In-memory plan tracking and project-local plan path helpers
// pos: Runtime-neutral plan state shared by Pi and the legacy Claude adapter

import { getSessionPlansPath } from '../sessions/storage.ts';

const sessionPlanFilePaths = new Map<string, string>();

export function getLastPlanFilePath(sessionId: string): string | null {
  return sessionPlanFilePaths.get(sessionId) ?? null;
}

export function setLastPlanFilePath(sessionId: string, path: string): void {
  sessionPlanFilePaths.set(sessionId, path);
}

export function clearPlanFileState(sessionId: string): void {
  sessionPlanFilePaths.delete(sessionId);
}

export function getSessionPlansDir(workspacePath: string, sessionId: string): string {
  return getSessionPlansPath(workspacePath, sessionId);
}

export function isPathInPlansDir(path: string, workspacePath: string, sessionId: string): boolean {
  return path.startsWith(getSessionPlansDir(workspacePath, sessionId));
}
