// input: Session metadata, writing files, and a user search query
// output: Ranked global search result groups for the app shell
// pos: Pure search adapter behind the top-bar global search dialog

import { fuzzyScore } from '@craft-agent/shared/search'
import type { SessionMeta } from '@/atoms/sessions'
import { getSessionPreviewText, getSessionTitle } from '@/utils/session'
import type { NovelWorkspaceFile } from './writing-workspace'

const MIN_QUERY_LENGTH = 2
const MAX_RESULTS_PER_GROUP = 8

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
}

export interface GlobalSearchResults {
  sessions: GlobalSearchSessionResult[]
  files: GlobalSearchFileResult[]
}

export interface BuildGlobalSearchResultsOptions {
  query: string
  sessions: SessionMeta[]
  novelFiles: NovelWorkspaceFile[]
  sessionContentResults?: Map<string, { matchCount: number; snippet: string }>
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
  return a.file.relativePath.localeCompare(b.file.relativePath, undefined, { numeric: true, sensitivity: 'base' })
}

export function buildGlobalSearchResults({
  query,
  sessions,
  novelFiles,
  sessionContentResults,
  formatNovelFileTitle,
}: BuildGlobalSearchResultsOptions): GlobalSearchResults {
  const normalizedQuery = normalize(query)
  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    return { sessions: [], files: [] }
  }

  const sessionResults = sessions
    .filter(session => !session.hidden)
    .map((session): GlobalSearchSessionResult | null => {
      const title = getSessionTitle(session)
      const contentResult = sessionContentResults?.get(session.id)
      const preview = contentResult?.snippet || getSessionPreviewText(session)
      const score = Math.max(
        scoreText(title, normalizedQuery),
        scoreText(preview, normalizedQuery),
        contentResult ? contentResult.matchCount + 90 : 0,
      )

      return score > 0 ? { session, title, preview, score, matchCount: contentResult?.matchCount } : null
    })
    .filter((result): result is GlobalSearchSessionResult => result != null)
    .sort(compareByScoreThenRecent)
    .slice(0, MAX_RESULTS_PER_GROUP)

  const fileResults = novelFiles
    .map((file): GlobalSearchFileResult | null => {
      const title = formatNovelFileTitle(file)
      const score = Math.max(
        scoreText(title, normalizedQuery),
        scoreText(file.relativePath, normalizedQuery),
      )

      return score > 0 ? { file, title, score } : null
    })
    .filter((result): result is GlobalSearchFileResult => result != null)
    .sort(compareFileResults)
    .slice(0, MAX_RESULTS_PER_GROUP)

  return {
    sessions: sessionResults,
    files: fileResults,
  }
}
