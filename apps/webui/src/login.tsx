// input: Browser auth endpoints and Neon Auth / Feishu capability configuration.
// output: React login, registration, verification-pending, and error states.
// pos: Public authentication UI for the headless Web UI.

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import './login.css'

type EmailMode = 'sign-in' | 'sign-up'
type Notice = { kind: 'error' | 'success', message: string } | null

interface AuthConfig {
  neonEnabled: boolean
  emailSignUpEnabled: boolean
  passwordAuthEnabled: boolean
  feishuEnabled: boolean
  usernameLoginEnabled: boolean
}

const DEFAULT_AUTH_CONFIG: AuthConfig = {
  neonEnabled: false,
  emailSignUpEnabled: false,
  passwordAuthEnabled: true,
  feishuEnabled: false,
  usernameLoginEnabled: false,
}

function formatEmailAuthError(message: unknown): string {
  if (message === 'Invalid email or password') {
    return 'Account or password is incorrect. Create an account first if you do not have one.'
  }
  if (message === 'Email sign-up is disabled') return 'Email registration is not enabled on this server.'
  if (message === 'A full email address is required to create an account') {
    return 'Enter a full email address to create an account.'
  }
  if (typeof message === 'string' && message.trim()) return message
  return 'Email authentication failed. Please try again.'
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json()
    return data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export default function LoginPage() {
  const [authConfig, setAuthConfig] = useState<AuthConfig>(DEFAULT_AUTH_CONFIG)
  const [configReady, setConfigReady] = useState(false)
  const [mode, setMode] = useState<EmailMode>('sign-in')
  const [notice, setNotice] = useState<Notice>(null)
  const [serverNotice, setServerNotice] = useState<Notice>(null)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [emailLoading, setEmailLoading] = useState(false)
  const [serverLoading, setServerLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadConfig() {
      const [neonResult, feishuResult] = await Promise.allSettled([
        fetch('/api/auth/neon/config'),
        fetch('/api/auth/feishu/config'),
      ])

      if (cancelled) return

      const nextConfig = { ...DEFAULT_AUTH_CONFIG }
      if (neonResult.status === 'fulfilled' && neonResult.value.ok) {
        const data = await readJson(neonResult.value)
        nextConfig.neonEnabled = data.enabled === true
        nextConfig.emailSignUpEnabled = data.emailSignUpEnabled === true
        nextConfig.passwordAuthEnabled = data.passwordAuthEnabled !== false
        nextConfig.usernameLoginEnabled = data.usernameLoginEnabled === true
      }
      if (feishuResult.status === 'fulfilled' && feishuResult.value.ok) {
        const data = await readJson(feishuResult.value)
        nextConfig.feishuEnabled = data.enabled === true
      }

      setAuthConfig(nextConfig)
      setConfigReady(true)
    }

    void loadConfig()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!authConfig.emailSignUpEnabled && mode === 'sign-up') setMode('sign-in')
  }, [authConfig.emailSignUpEnabled, mode])

  const hasAuthMethod = useMemo(
    () => authConfig.neonEnabled || authConfig.passwordAuthEnabled || authConfig.feishuEnabled,
    [authConfig],
  )
  const isSignUp = mode === 'sign-up'
  const identifierLabel = authConfig.usernameLoginEnabled && !isSignUp ? 'Email or username' : 'Email'
  const identifierPlaceholder = authConfig.usernameLoginEnabled && !isSignUp ? 'you@example.com or username' : 'you@example.com'

  function clearNotice() {
    setNotice(null)
    setServerNotice(null)
  }

  function chooseMode(nextMode: EmailMode) {
    if (nextMode === 'sign-up' && !authConfig.emailSignUpEnabled) return
    clearNotice()
    setPendingEmail(null)
    setMode(nextMode)
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearNotice()

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const name = String(form.get('name') ?? '').trim()

    if (isSignUp && !email.includes('@')) {
      setNotice({ kind: 'error', message: 'Enter a full email address to create an account.' })
      return
    }

    setEmailLoading(true)
    try {
      const response = await fetch('/api/auth/neon/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          mode,
          email,
          password,
          ...(isSignUp && name ? { name } : {}),
        }),
      })
      const data = await readJson(response)

      if (response.ok && data.ok === true) {
        window.location.assign('/')
        return
      }

      if (response.status === 202 && data.status === 'verification-required') {
        setPendingEmail(email)
        setNotice(null)
        return
      }

      setNotice({ kind: 'error', message: formatEmailAuthError(data.error) })
    } catch {
      setNotice({ kind: 'error', message: 'Network error. Is the server running?' })
    } finally {
      setEmailLoading(false)
    }
  }

  async function submitServerToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearNotice()
    setServerLoading(true)

    try {
      const form = new FormData(event.currentTarget)
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password: String(form.get('server-token') ?? '') }),
      })
      if (response.ok) {
        window.location.assign('/')
        return
      }
      const data = await readJson(response)
      setServerNotice({ kind: 'error', message: typeof data.error === 'string' ? data.error : 'Authentication failed.' })
    } catch {
      setServerNotice({ kind: 'error', message: 'Network error. Is the server running?' })
    } finally {
      setServerLoading(false)
    }
  }

  if (!configReady) {
    return <div className="boot-loader" aria-label="Loading Craft Agents"><span className="boot-loader__mark">CA</span></div>
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Craft Agents">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">CA</span>
          <span className="brand-name">Craft Agents</span>
        </div>
        <div>
          <p className="eyebrow">A workspace for focused work</p>
          <h1 className="story-title">Make room for the work that matters.</h1>
        </div>
        <p className="story-copy">Sign in to continue to your sessions, projects, and writing tools. Your account identity stays separate from the model credentials used inside the workspace.</p>
        <ul className="story-notes" aria-label="Account details">
          <li className="story-note">Email verification is handled by Neon Auth.</li>
          <li className="story-note">Successful sign-in opens a secure Craft session.</li>
          <li className="story-note">Server-token access remains available when configured.</li>
        </ul>
      </section>

      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-stack">
          <header className="auth-header">
            <p className="eyebrow">{isSignUp ? 'New account' : 'Welcome back'}</p>
            <h2 className="auth-title" id="auth-title">{isSignUp ? 'Create your account' : 'Sign in to Craft Agents'}</h2>
            <p className="subtitle">{isSignUp ? 'Use an email address you can access. We will send a verification code before the first sign-in.' : 'Choose the account method configured for this server.'}</p>
          </header>

          {!hasAuthMethod && <div className="notice notice--error" role="alert">No login method is configured on this server.</div>}

          {pendingEmail ? (
            <div className="verification-card" role="status" aria-live="polite">
              <span className="verification-card__icon" aria-hidden="true">✓</span>
              <div>
                <h2>Check your inbox</h2>
                <p>We sent a verification code to <strong>{pendingEmail}</strong>. Enter it in the email from Neon Auth, then return here to sign in.</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => chooseMode('sign-in')}>Back to sign in</button>
            </div>
          ) : (
            <div className="auth-methods">
              {authConfig.feishuEnabled && (
                <button className="feishu-button" type="button" onClick={() => { window.location.href = '/api/auth/feishu/start' }}>Continue with Feishu</button>
              )}
              {authConfig.feishuEnabled && authConfig.neonEnabled && <div className="method-divider">or use email</div>}

              {authConfig.neonEnabled && (
                <form className="email-form" onSubmit={submitEmail}>
                  {authConfig.emailSignUpEnabled && (
                    <div className="mode-switch" aria-label="Email auth mode">
                      <button className={`mode-button${!isSignUp ? ' mode-button--active' : ''}`} type="button" onClick={() => chooseMode('sign-in')}>Sign in</button>
                      <button className={`mode-button${isSignUp ? ' mode-button--active' : ''}`} type="button" onClick={() => chooseMode('sign-up')}>Create account</button>
                    </div>
                  )}
                  {isSignUp && (
                    <div className="field">
                      <label htmlFor="name">Name <span aria-hidden="true">(optional)</span></label>
                      <input id="name" name="name" type="text" placeholder="How should we call you?" autoComplete="name" />
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="email">{identifierLabel}</label>
                    <input id="email" name="email" type={authConfig.usernameLoginEnabled && !isSignUp ? 'text' : 'email'} placeholder={identifierPlaceholder} autoComplete={authConfig.usernameLoginEnabled && !isSignUp ? 'username' : 'email'} required autoFocus />
                  </div>
                  <div className="field">
                    <label htmlFor="email-password">Password</label>
                    <input id="email-password" name="password" type="password" placeholder={isSignUp ? 'Create a password' : 'Your password'} autoComplete={isSignUp ? 'new-password' : 'current-password'} required />
                  </div>
                  {isSignUp && <p className="field-hint">After registration, check your email for the verification code before signing in.</p>}
                  {notice && <div className={`notice notice--${notice.kind}`} role="alert">{notice.message}</div>}
                  <button className="primary-button" type="submit" disabled={emailLoading}>{emailLoading ? (isSignUp ? 'Creating account…' : 'Signing in…') : (isSignUp ? 'Create account' : 'Sign in')}</button>
                </form>
              )}

              {authConfig.passwordAuthEnabled && (authConfig.neonEnabled || authConfig.feishuEnabled) && <div className="method-divider">or use server token</div>}

              {authConfig.passwordAuthEnabled && (
                <form className="server-form" onSubmit={submitServerToken}>
                  <div className="field">
                    <label htmlFor="server-token">Server token</label>
                    <input id="server-token" name="server-token" type="password" placeholder="Enter the configured server token" autoComplete="current-password" required />
                  </div>
                  {serverNotice && <div className={`notice notice--${serverNotice.kind}`} role="alert">{serverNotice.message}</div>}
                  <button className="secondary-button" type="submit" disabled={serverLoading}>{serverLoading ? 'Signing in…' : 'Sign in with token'}</button>
                </form>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<LoginPage />)
