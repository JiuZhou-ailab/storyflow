import { describe, expect, test } from 'bun:test'
import { createDemoAdapter } from './adapter'
import { chapterPath, initialFiles } from './fixture'

describe('demo text document host', () => {
  test('opens editable text and persists versioned saves through the shared file store', async () => {
    const { api } = createDemoAdapter(() => {})
    const target = { path: chapterPath }
    const snapshot = await api.readTextDocument(target)
    expect(snapshot).toMatchObject({ content: initialFiles[chapterPath], readOnly: false, format: { bom: false, crlf: false } })
    const content = snapshot.content + '\n手动修改。'
    const saved = await api.saveTextDocument({ ...target, version: snapshot.version, content })
    expect(saved.status).toBe('saved')
    expect(await api.readFile(chapterPath)).toBe(content)
    expect(await api.readTextDocument(target)).toMatchObject({ content, version: saved.status === 'saved' ? saved.version : '' })
    expect(await api.saveTextDocument({ ...target, version: snapshot.version, content: '过期修改' })).toEqual({ status: 'conflict' })
    expect(await api.readFile(chapterPath)).toBe(content)
  })

  test('detects writes from other host operations and keeps reset instances isolated', async () => {
    const { api } = createDemoAdapter(() => {})
    const target = { path: chapterPath }
    const snapshot = await api.readTextDocument(target)
    await api.writeFile(chapterPath, '示例任务的改动')
    expect(await api.saveTextDocument({ ...target, version: snapshot.version, content: '旧草稿' })).toEqual({ status: 'conflict' })
    expect(await api.readFile(chapterPath)).toBe('示例任务的改动')
    expect((await createDemoAdapter(() => {}).api.readTextDocument(target)).content).toBe(initialFiles[chapterPath])
  })

  test('rejects files outside the fixture, conversation identities and invalid saves', async () => {
    const { api } = createDemoAdapter(() => {})
    for (const path of ['/outside.md', '/demo-project/missing.md']) {
      await expect(api.readTextDocument({ path })).rejects.toThrow('示例文件不存在')
      await expect(api.saveTextDocument({ path, version: '', content: 'new' })).rejects.toThrow('示例文件不存在')
    }
    await expect(api.readTextDocument({ path: chapterPath, sessionId: 'demo-writing' })).rejects.toThrow('不使用对话身份')
    const snapshot = await api.readTextDocument({ path: chapterPath })
    await expect(api.saveTextDocument({ path: chapterPath, version: snapshot.version, content: '\r\n' })).rejects.toThrow('无效')
    expect((await api.readTextDocument({ path: chapterPath })).content).toBe(snapshot.content)
  })
})
