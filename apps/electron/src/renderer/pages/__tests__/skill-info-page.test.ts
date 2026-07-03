// input: SkillInfoPage source and shared skills atom contract
// output: Regression coverage against duplicate skills IPC loads
// pos: Protects the skills detail page from re-scanning skills already owned by AppShell

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const skillInfoPageSource = readFileSync(new URL('../SkillInfoPage.tsx', import.meta.url), 'utf8')

describe('SkillInfoPage performance contract', () => {
  it('uses the AppShell-populated skills atom instead of loading skills again', () => {
    expect(skillInfoPageSource).toContain("import { skillsAtom } from '@/atoms/skills'")
    expect(skillInfoPageSource).toContain('useAtomValue(skillsAtom)')
    expect(skillInfoPageSource).not.toContain('window.electronAPI.getSkills')
    expect(skillInfoPageSource).not.toContain('onSkillsChanged')
  })
})
