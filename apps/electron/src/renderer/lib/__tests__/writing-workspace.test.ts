import { describe, expect, it } from 'bun:test'
import type { FileChange } from '@craft-agent/ui'
import {
  buildNovelWorkspaceTree,
  detectNovelProjectFromSearchResults,
  mapSearchResultsToNovelWorkspaceFiles,
  groupNovelFileChanges,
  selectDefaultNovelTab,
  summarizeNovelSection,
} from '../writing-workspace'

describe('writing workspace helpers', () => {
  it('groups novel files into workspace sections', () => {
    const tree = buildNovelWorkspaceTree([
      { path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' },
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md' },
      { path: '/novel/bible/characters/alice.md', relativePath: 'bible/characters/alice.md' },
      { path: '/novel/bible/universe/paris.md', relativePath: 'bible/universe/paris.md' },
      { path: '/novel/state/current/situation.md', relativePath: 'state/current/situation.md' },
      { path: '/novel/timeline/history.md', relativePath: 'timeline/history.md' },
      { path: '/novel/.work/chapter-01-plan.md', relativePath: '.work/chapter-01-plan.md' },
    ])

    expect(tree.manuscript.files.map(file => file.relativePath)).toEqual(['story/chapters/chapter-01.md'])
    expect(tree.outline.files.map(file => file.relativePath)).toEqual(['story/plan.md'])
    expect(tree.characters.files.map(file => file.relativePath)).toEqual(['bible/characters/alice.md'])
    expect(tree.locations.files.map(file => file.relativePath)).toEqual(['bible/universe/paris.md'])
    expect(tree.state.files.map(file => file.relativePath)).toEqual(['state/current/situation.md'])
    expect(tree.timeline.files.map(file => file.relativePath)).toEqual(['timeline/history.md'])
    expect(tree.work.files.map(file => file.relativePath)).toEqual(['.work/chapter-01-plan.md'])
  })

  it('selects manuscript as default when chapters exist', () => {
    const tree = buildNovelWorkspaceTree([
      { path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' },
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md' },
    ])

    expect(selectDefaultNovelTab(tree)).toBe('manuscript')
  })

  it('selects outline as default before chapters exist', () => {
    const tree = buildNovelWorkspaceTree([
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md' },
    ])

    expect(selectDefaultNovelTab(tree)).toBe('outline')
  })

  it('summarizes section count and latest modified time', () => {
    const summary = summarizeNovelSection([
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md', modifiedAt: 10 },
      { path: '/novel/story/synopsis.md', relativePath: 'story/synopsis.md', modifiedAt: 20 },
    ])

    expect(summary).toEqual({ count: 2, latestModifiedAt: 20 })
  })

  it('groups raw file changes by novel section', () => {
    const changes: FileChange[] = [
      change('/novel/bible/characters/alice.md'),
      change('/novel/story/chapters/chapter-02.md'),
      change('/novel/timeline/current-chapter.md'),
      change('/novel/README.md'),
    ]

    const grouped = groupNovelFileChanges(changes, '/novel')

    expect(grouped.characters.map(item => item.filePath)).toEqual(['/novel/bible/characters/alice.md'])
    expect(grouped.manuscript.map(item => item.filePath)).toEqual(['/novel/story/chapters/chapter-02.md'])
    expect(grouped.timeline.map(item => item.filePath)).toEqual(['/novel/timeline/current-chapter.md'])
    expect(grouped.other.map(item => item.filePath)).toEqual(['/novel/README.md'])
  })

  it('maps file search results to novel workspace files and drops unknown files', () => {
    const files = mapSearchResultsToNovelWorkspaceFiles([
      { name: 'chapter-01.md', path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md', type: 'file' },
      { name: 'README.md', path: '/novel/README.md', relativePath: 'README.md', type: 'file' },
      { name: 'characters', path: '/novel/bible/characters', relativePath: 'bible/characters', type: 'directory' },
    ])

    expect(files).toEqual([
      { path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' },
    ])
  })

  it('detects a novel project from a manifest search result', () => {
    expect(detectNovelProjectFromSearchResults([
      { name: 'craft-writing.json', path: '/novel/craft-writing.json', relativePath: 'craft-writing.json', type: 'file' },
    ])).toBe(true)
  })

  it('detects a Claude-Book-compatible novel directory structure from search results', () => {
    expect(detectNovelProjectFromSearchResults([
      { name: 'bible', path: '/novel/bible', relativePath: 'bible', type: 'directory' },
      { name: 'story', path: '/novel/story', relativePath: 'story', type: 'directory' },
      { name: 'state', path: '/novel/state', relativePath: 'state', type: 'directory' },
      { name: 'timeline', path: '/novel/timeline', relativePath: 'timeline', type: 'directory' },
    ])).toBe(true)
  })

  it('does not detect partial writing-like structures as a novel project', () => {
    expect(detectNovelProjectFromSearchResults([
      { name: 'story', path: '/repo/story', relativePath: 'story', type: 'directory' },
      { name: 'README.md', path: '/repo/README.md', relativePath: 'README.md', type: 'file' },
    ])).toBe(false)
  })
})

function change(filePath: string): FileChange {
  return {
    id: filePath,
    filePath,
    toolType: 'Edit',
    original: 'old',
    modified: 'new',
  }
}
