// input: Reads the Web UI login shell, React auth entrypoint, and auth styles.
// output: Verifies the public auth surface keeps its React and responsive layout contract.
// pos: Regression coverage for the standalone Web UI login surface.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const loginHtml = readFileSync(join(import.meta.dir, 'login.html'), 'utf8')
const loginReact = readFileSync(join(import.meta.dir, 'login.tsx'), 'utf8')
const loginCss = readFileSync(join(import.meta.dir, 'login.css'), 'utf8')

describe('webui login layout', () => {
  it('uses a React entrypoint with a responsive auth surface', () => {
    expect(loginHtml).toContain('<div id="root">')
    expect(loginHtml).toContain('./login.tsx')
    expect(loginReact).toContain('export default function LoginPage()')
    expect(loginReact).toContain("createRoot(document.getElementById('root')!).render(<LoginPage />)")
    expect(loginReact).toContain('verification-card')
    expect(loginCss).toContain('.auth-page')
    expect(loginCss).toContain('grid-template-columns: minmax(280px, 0.92fr) minmax(400px, 1.08fr)')
  })

  it('keeps the email registration tab behind the Neon sign-up flag', () => {
    expect(loginReact).toContain('data.emailSignUpEnabled === true')
    expect(loginReact).toContain("nextMode === 'sign-up' && !authConfig.emailSignUpEnabled")
    expect(loginReact).toContain('Create account')
  })

  it('normalizes provider auth errors before rendering them', () => {
    expect(loginReact).toContain('formatEmailAuthError')
    expect(loginReact).toContain('Account or password is incorrect')
    expect(loginReact).not.toContain("data.error || 'Email authentication failed'")
  })

  it('keeps verification as an explicit pending state before sign-in', () => {
    expect(loginReact).toContain("response.status === 202 && data.status === 'verification-required'")
    expect(loginReact).toContain('Check your inbox')
    expect(loginReact).toContain('Back to sign in')
  })
})
