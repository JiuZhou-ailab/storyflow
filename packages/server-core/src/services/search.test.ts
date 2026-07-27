// input: Temporary session and workspace files searched through the real ripgrep process
// output: Regression proof for bounded conversation and document content hits
// pos: Runnable contract check for the shared full-text search engine

import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHeadlessPlatform } from '../runtime/platform-headless'
import {
  searchSessions,
  searchWorkspaceDocuments,
  setSearchPlatform,
} from './search'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'storyflow-search-'))
const sessionsDir = join(workspaceRoot, '.craft-agent', 'sessions')

setSearchPlatform(createHeadlessPlatform())

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('workspace search service', () => {
  it('finds real session and document content with navigable locators', async () => {
    const sessionDir = join(sessionsDir, 'session-visible')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'session.jsonl'), [
      '{"type":"header"}',
      '{"id":"m1","type":"user","content":"The obsidian dragon waits."}',
    ].join('\n'))
    mkdirSync(join(workspaceRoot, 'manuscript'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'manuscript', 'chapter-01.md'), 'The obsidian dragon wakes.\n')

    const [sessions, documents] = await Promise.all([
      searchSessions('obsidian dragon', sessionsDir),
      searchWorkspaceDocuments('obsidian dragon', workspaceRoot),
    ])

    expect(sessions[0]?.sessionId).toBe('session-visible')
    expect(sessions[0]?.matches[0]?.snippet).toContain('obsidian dragon')
    expect(documents[0]).toMatchObject({
      relativePath: 'manuscript/chapter-01.md',
      matches: [{ lineNumber: 1, snippet: 'The obsidian dragon wakes.' }],
    })
  })
})
