// input: Session storage path, visible assistant message IDs, and Pi SDK turn IDs
// output: Durable lookup plus strict branch-anchor validation for Pi session forks
// pos: Persistence boundary mapping Storyflow messages to provider-owned Pi tree nodes

import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const PI_TURN_ANCHORS_VERSION = 1;
const PI_TURN_ANCHORS_FILE = 'pi-turn-anchors.json';

interface PiTurnAnchorsIndex {
  version: number;
  anchors: Record<string, string>;
}

function getPiTurnAnchorsPath(sessionPath: string): string {
  return join(sessionPath, 'meta', PI_TURN_ANCHORS_FILE);
}

export async function loadPiTurnAnchors(sessionPath: string): Promise<PiTurnAnchorsIndex> {
  try {
    const raw = await readFile(getPiTurnAnchorsPath(sessionPath), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PiTurnAnchorsIndex>;
    const anchors = parsed.anchors && typeof parsed.anchors === 'object' ? parsed.anchors : {};
    const normalized: Record<string, string> = {};
    for (const [messageId, anchor] of Object.entries(anchors)) {
      if (messageId && typeof anchor === 'string' && anchor) normalized[messageId] = anchor;
    }
    return { version: PI_TURN_ANCHORS_VERSION, anchors: normalized };
  } catch {
    return { version: PI_TURN_ANCHORS_VERSION, anchors: {} };
  }
}

export async function getPiTurnAnchor(
  sessionPath: string,
  messageId: string,
): Promise<string | undefined> {
  if (!messageId) return undefined;
  return (await loadPiTurnAnchors(sessionPath)).anchors[messageId];
}

export async function savePiTurnAnchor(
  sessionPath: string,
  messageId: string,
  anchorId: string,
): Promise<void> {
  if (!messageId || !anchorId) return;

  const index = await loadPiTurnAnchors(sessionPath);
  if (index.anchors[messageId] === anchorId) return;
  index.anchors[messageId] = anchorId;

  await mkdir(join(sessionPath, 'meta'), { recursive: true });
  await writeFile(getPiTurnAnchorsPath(sessionPath), JSON.stringify(index), 'utf-8');
}

export function requireSdkForkBranchAnchor(input: {
  branchFromSessionId: string;
  branchFromMessageId: string;
  branchFromSdkTurnId?: string;
}): string {
  if (input.branchFromSdkTurnId) return input.branchFromSdkTurnId;
  throw new Error(
    `Cannot create branch yet: selected message is missing a Pi branch anchor (source=${input.branchFromSessionId}; message=${input.branchFromMessageId}). Branch from a completed assistant response and try again.`,
  );
}
