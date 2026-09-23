// input: A runtime-owned file identity and text editing commands
// output: Versioned text snapshots, save outcomes and recovery records
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
  version: string
  content: string
  destination?: string
  format?: { bom: boolean; crlf: boolean }
}
export type TextDocumentSaveResult =
  | { status: 'saved'; version: string; path: string }
  | { status: 'conflict' | 'missing' }
export interface TextDocumentRecovery { id: string; createdAt: number }
export interface TextDocumentRecoveryContent { before: string; submitted: string }
