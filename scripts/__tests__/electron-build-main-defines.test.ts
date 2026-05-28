// input: Electron main-process build script source
// output: Regression coverage for public auth bootstrap defines
// pos: Guards packaged desktop auth config from missing public values or bundled secrets

import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

describe('electron build defines', () => {
  it('bakes desktop auth bootstrap values and the direct model gateway token into the main bundle', async () => {
    const source = await Bun.file(join(import.meta.dir, '..', 'electron-build-main.ts')).text()

    expect(source).toContain('"CRAFT_CLIENT_AUTH_REQUIRED"')
    expect(source).toContain('"CRAFT_CLIENT_AUTH_BROKER_URL"')
    expect(source).toContain('"CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL"')
    expect(source).toContain('"CRAFT_CLIENT_FEISHU_APP_ID"')
    expect(source).toContain('"CRAFT_CLIENT_FEISHU_SCOPE"')
    expect(source).toContain('"CRAFT_CLIENT_GATEWAY_TOKEN"')
    expect(source).not.toContain('"CRAFT_CLIENT_FEISHU_APP_SECRET"')
    expect(source).not.toContain('"CRAFT_WEBUI_FEISHU_APP_SECRET"')
  })

  it('runs desktop auth build validation before bundling the main process', async () => {
    const source = await Bun.file(join(import.meta.dir, '..', 'electron-build-main.ts')).text()

    expect(source).toContain('validateDesktopAuthBuildEnv(process.env)')
    expect(source).toContain('validateDesktopAuthBuildConfig()')
  })

  it('loads build env through the shared non-overriding env loader', async () => {
    const source = await Bun.file(join(import.meta.dir, '..', 'electron-build-main.ts')).text()

    expect(source).toContain('import { loadEnvFiles } from "./env-loader"')
    expect(source).toContain('loadEnvFiles({ rootDir: ROOT_DIR, mode: "build" })')
  })

  it('reads packaged client-auth values through direct process.env properties', async () => {
    const source = await Bun.file(join(import.meta.dir, '..', '..', 'apps/electron/src/main/client-auth.ts')).text()
    const directEnvKeys = [
      'CRAFT_CLIENT_AUTH_REQUIRED',
      'CRAFT_CLIENT_AUTH_BROKER_URL',
      'CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL',
      'CRAFT_CLIENT_FEISHU_APP_ID',
      'CRAFT_CLIENT_FEISHU_SCOPE',
      'CRAFT_CLIENT_FEISHU_AUTH_BASE_URL',
      'CRAFT_CLIENT_FEISHU_CALLBACK_PORT',
      'CRAFT_CLIENT_FEISHU_LOGIN_TIMEOUT_MS',
      'CRAFT_CLIENT_NEON_AUTH_BASE_URL',
      'CRAFT_CLIENT_NEON_AUTH_JWKS_URL',
      'CRAFT_CLIENT_NEON_AUTH_ISSUER',
      'CRAFT_CLIENT_NEON_AUTH_AUDIENCE',
      'CRAFT_CLIENT_NEON_AUTH_USERNAME_EMAIL_DOMAIN',
      'CRAFT_CLIENT_NEON_AUTH_ORIGIN',
    ]

    for (const key of directEnvKeys) {
      expect(source).toContain(`process.env.${key}`)
    }
  })
})
