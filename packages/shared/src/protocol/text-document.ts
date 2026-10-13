// input: A runtime-owned file identity and text editing commands
// output: Versioned text snapshots and save outcomes
// pos: Interactive text editing contract; independent of legacy file writes
export interface TextDocumentTarget { path: string; sessionId?: string }
export interface TextDocumentSnapshot {
  content: string
  version: string
  format: { bom: boolean; crlf: boolean }
  readOnly: boolean
  reason?: string
}
export interface TextDocumentSave extends TextDocumentTarget {
  /** Expected disk version; '' expects the file to be absent and recreates it. */
  version: string
  content: string
  format?: { bom: boolean; crlf: boolean }
}
export type TextDocumentSaveResult =
  | { status: 'saved'; version: string }
  | { status: 'conflict' | 'missing' }
