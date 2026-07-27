// input: Session metadata, writing files, and a user search query
// output: Ranked global search result groups for the app shell
// pos: Pure search adapter behind the top-bar global search dialog

import { fuzzyScore } from '@craft-agent/shared/search'
import type { WorkspaceSearchHit } from '@craft-agent/shared/protocol'
import type { Workspace } from '../../shared/types'
import type { SessionMeta } from '@/atoms/sessions'
import { getSessionPreviewText, getSessionTitle } from '@/utils/session'
import type { NovelWorkspaceFile } from './writing-workspace'

const MIN_QUERY_LENGTH = 2
const MAX_RESULTS_PER_GROUP = 8
const globalSearchFileCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export interface GlobalSearchSessionResult {
  session: SessionMeta
  title: string
  preview: string | null
  score: number
  matchCount?: number
}

export interface GlobalSearchFileResult {
  file: NovelWorkspaceFile
  title: string
  score: number
  preview?: string
  matchCount?: number
  lineNumber?: number
}

export interface GlobalSearchWorkspaceResult {
  workspace: Workspace
  score: number
}

export interface GlobalSearchResults {
  workspaces: GlobalSearchWorkspaceResult[]
  sessions: GlobalSearchSessionResult[]
  files: GlobalSearchFileResult[]
}

export interface BuildGlobalSearchResultsOptions {
  query: string
  workspaces?: Workspace[]
  sessions: SessionMeta[]
  novelFiles: NovelWorkspaceFile[]
  sessionContentResults?: Map<string, { matchCount: number; snippet: string }>
  workspaceSearchHits?: WorkspaceSearchHit[]
  formatNovelFileTitle: (file: NovelWorkspaceFile) => string
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function scoreText(text: string | null | undefined, normalizedQuery: string): number {
  if (!text) return 0

  const normalizedText = normalize(text)
  if (!normalizedText) return 0
  if (normalizedText.includes(normalizedQuery)) return normalizedQuery.length + 100
  return fuzzyScore(text, normalizedQuery)
}

function compareByScoreThenRecent(
  a: Pick<GlobalSearchSessionResult, 'score' | 'session'>,
  b: Pick<GlobalSearchSessionResult, 'score' | 'session'>,
): number {
  if (a.score !== b.score) return b.score - a.score
  return (b.session.lastMessageAt || 0) - (a.session.lastMessageAt || 0)
}

function compareFileResults(a: GlobalSearchFileResult, b: GlobalSearchFileResult): number {
  if (a.score !== b.score) return b.score - a.score
  return globalSearchFileCollator.compare(a.file.relativePath, b.file.relativePath)
}

function compareWorkspaceResults(a: GlobalSearchWorkspaceResult, b: GlobalSearchWorkspaceResult): number {
  if (a.score !== b.score) return b.score - a.score
  return (b.workspace.lastAccessedAt ?? 0) - (a.workspace.lastAccessedAt ?? 0)
}

function insertBoundedResult<T>(results: T[], result: T, compare: (a: T, b: T) => number): void {
  const insertIndex = results.findIndex(existing => compare(result, existing) < 0)

  if (insertIndex === -1) {
    if (results.length < MAX_RESULTS_PER_GROUP) {
      results.push(result)
    }
    return
  }

  results.splice(insertIndex, 0, result)
  if (results.length > MAX_RESULTS_PER_GROUP) {
    results.pop()
  }
}

export function buildGlobalSearchResults({
  query,
  workspaces = [],
  sessions,
  novelFiles,
  sessionContentResults,
  workspaceSearchHits = [],
  formatNovelFileTitle,
}: BuildGlobalSearchResultsOptions): GlobalSearchResults {
  const normalizedQuery = normalize(query)
  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    return { workspaces: [], sessions: [], files: [] }
  }

  const workspaceResults: GlobalSearchWorkspaceResult[] = []
  for (const workspace of workspaces) {
    if (workspace.archivedAt) continue
    const score = scoreText(workspace.name, normalizedQuery)
    if (score > 0) {
      insertBoundedResult(workspaceResults, { workspace, score }, compareWorkspaceResults)
    }
  }

  const contentResults = new Map(sessionContentResults)
  const documentContentResults = new Map<string, Extract<WorkspaceSearchHit, { kind: 'document' }>>()
  for (const hit of workspaceSearchHits) {
    if (hit.kind === 'session') {
      contentResults.set(hit.sessionId, { matchCount: hit.matchCount, snippet: hit.snippet })
    } else {
      documentContentResults.set(hit.path, hit)
    }
  }

  const sessionResults: GlobalSearchSessionResult[] = []
  for (const session of sessions) {
    if (session.hidden) continue

    const title = getSessionTitle(session)
    const contentResult = contentResults.get(session.id)
    const preview = contentResult?.snippet || getSessionPreviewText(session)
    const score = Math.max(
      scoreText(title, normalizedQuery),
      scoreText(preview, normalizedQuery),
      contentResult ? contentResult.matchCount + 90 : 0,
    )

    if (score > 0) {
      insertBoundedResult(
        sessionResults,
        { session, title, preview, score, matchCount: contentResult?.matchCount },
        compareByScoreThenRecent,
      )
    }
  }

  const fileResults: GlobalSearchFileResult[] = []
  const searchableFiles = new Map(novelFiles.map(file => [file.path, file]))
  for (const hit of documentContentResults.values()) {
    if (!searchableFiles.has(hit.path)) {
      searchableFiles.set(hit.path, { path: hit.path, relativePath: hit.relativePath })
    }
  }
  for (const file of searchableFiles.values()) {
    const title = formatNovelFileTitle(file)
    const contentResult = documentContentResults.get(file.path)
    const score = Math.max(
      scoreText(title, normalizedQuery),
      scoreText(file.relativePath, normalizedQuery),
      contentResult ? contentResult.matchCount + 90 : 0,
    )

    if (score > 0) {
      insertBoundedResult(fileResults, {
        file,
        title,
        score,
        preview: contentResult?.snippet,
        matchCount: contentResult?.matchCount,
        lineNumber: contentResult?.lineNumber,
      }, compareFileResults)
    }
  }

  return {
    workspaces: workspaceResults,
    sessions: sessionResults,
    files: fileResults,
  }
}
