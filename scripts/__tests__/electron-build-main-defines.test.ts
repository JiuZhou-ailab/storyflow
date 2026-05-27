// input: Electron main-process build script source
// output: Regression coverage for public auth bootstrap defines
// pos: Guards packaged desktop auth config from missing public values or bundled secrets

import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

describe('electron build defines', () => {
  it('bakes only public desktop auth bootstrap values into the main bundle', async () => {
    const source = await Bun.file(join(import.meta.dir, '..', 'electron-build-main.ts')).text()

    expect(source).toContain('"CRAFT_CLIENT_AUTH_REQUIRED"')
    expect(source).toContain('"CRAFT_CLIENT_AUTH_BROKER_URL"')
    expect(source).toContain('"CRAFT_CLIENT_FEISHU_APP_ID"')
    expect(source).toContain('"CRAFT_CLIENT_GATEWAY_LLM_CONNECTION_SLUG"')
    expect(source).not.toContain('"CRAFT_CLIENT_FEISHU_APP_SECRET"')
    expect(source).not.toContain('"CRAFT_WEBUI_FEISHU_APP_SECRET"')
    expect(source).not.toContain('"CRAFT_BUILTIN_LLM_API_KEY"')
  })
})
