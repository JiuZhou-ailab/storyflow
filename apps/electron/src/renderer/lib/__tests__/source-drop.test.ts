// input: Absolute filesystem paths captured from OS drag-and-drop
// output: Source creation inputs for local data sources
// pos: Preserves dropped user data as reusable source configuration

import { describe, expect, it } from 'bun:test'
import { buildDroppedLocalSourceInputs } from '../source-drop'

describe('buildDroppedLocalSourceInputs', () => {
  it('creates one enabled local source input per dropped filesystem path', () => {
    const inputs = buildDroppedLocalSourceInputs([
      '/Users/me/data/customer-notes.md',
      '/Users/me/projects/research',
    ])

    expect(inputs).toEqual([
      {
        name: 'customer-notes',
        provider: 'local',
        type: 'local',
        enabled: true,
        local: { path: '/Users/me/data/customer-notes.md' },
      },
      {
        name: 'research',
        provider: 'local',
        type: 'local',
        enabled: true,
        local: { path: '/Users/me/projects/research' },
      },
    ])
  })

  it('ignores empty paths and supports Windows separators', () => {
    expect(buildDroppedLocalSourceInputs(['', 'C:\\Users\\me\\data\\report.xlsx'])).toEqual([
      {
        name: 'report',
        provider: 'local',
        type: 'local',
        enabled: true,
        local: { path: 'C:\\Users\\me\\data\\report.xlsx' },
      },
    ])
  })
})
