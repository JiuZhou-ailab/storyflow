// input: Renderer startup and main-process client auth IPC
// output: Login gate that prevents the desktop App tree from mounting until authenticated
// pos: First renderer boundary before workspace/session UI initializes

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AlertCircle, Loader2, LockKeyhole, LogIn, MessageSquareText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ClientAuthState } from '../../../shared/types'

interface ClientAuthGateProps {
  children: ReactNode
}

export function ClientAuthGate({ children }: ClientAuthGateProps) {
  const [state, setState] = useState<ClientAuthState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    async function loadState() {
      try {
        if (!window.electronAPI?.getClientAuthState) {
          if (!cancelled) {
            setState({
              required: false,
              configured: false,
              authenticated: true,
              emailPasswordEnabled: false,
              feishuLoginEnabled: false,
            })
          }
          return
        }

        const nextState = await window.electronAPI.getClientAuthState()
        if (!cancelled) setState(nextState)
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err))
      }
    }

    void loadState()
    unsubscribe = window.electronAPI?.onClientAuthStateChanged?.((nextState) => {
      if (!cancelled) {
        setLoadError(null)
        setState(nextState)
      }
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  if (loadError) {
    return (
      <AuthShell>
        <AuthStatus
          tone="error"
          title="鉴权初始化失败"
          description={loadError}
        />
      </AuthShell>
    )
  }

  if (!state) {
    return (
      <AuthShell>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在检查登录状态
        </div>
      </AuthShell>
    )
  }

  if (!state.required || state.authenticated) {
    return <>{children}</>
  }

  if (!state.configured) {
    return (
      <AuthShell>
        <AuthStatus
          tone="error"
          title="客户端鉴权未配置"
          description="已启用客户端鉴权，但没有可用的邮箱或飞书登录配置。请检查 Neon Auth 或 Feishu Auth 环境变量。"
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <ClientSignInForm
        emailPasswordEnabled={state.emailPasswordEnabled}
        feishuLoginEnabled={state.feishuLoginEnabled}
        usernameLoginEnabled={state.usernameLoginEnabled === true}
        onSignedIn={async () => {
          setState(await window.electronAPI.getClientAuthState())
        }}
      />
    </AuthShell>
  )
}

function ClientSignInForm({
  emailPasswordEnabled,
  feishuLoginEnabled,
  usernameLoginEnabled,
  onSignedIn,
}: {
  emailPasswordEnabled: boolean
  feishuLoginEnabled: boolean
  usernameLoginEnabled: boolean
  onSignedIn: () => Promise<void>
}) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [feishuSubmitting, setFeishuSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      await window.electronAPI.signInClient({ identifier, password })
      await onSignedIn()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFeishuSignIn() {
    setFeishuSubmitting(true)
    setError(null)

    try {
      await window.electronAPI.signInWithFeishuClient()
      await onSignedIn()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setFeishuSubmitting(false)
    }
  }

  async function handleCancelFeishuSignIn() {
    try {
      await window.electronAPI.cancelFeishuSignInClient()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <div className="w-full max-w-[360px]">
      <div className="mb-7 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-md border border-foreground/10 bg-foreground/[0.03]">
          <LockKeyhole className="size-5 text-foreground/75" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold leading-6 text-foreground">登录 Storyflow</h1>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            使用飞书账号继续
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <Button
          className="w-full"
          type="button"
          variant={feishuLoginEnabled ? 'default' : 'outline'}
          disabled={!feishuLoginEnabled || feishuSubmitting || submitting}
          onClick={handleFeishuSignIn}
        >
          {feishuSubmitting ? <Loader2 className="size-4 animate-spin" /> : <MessageSquareText className="size-4" />}
          {feishuLoginEnabled ? '使用飞书登录' : '飞书登录未配置'}
        </Button>

        {feishuSubmitting ? (
          <Button
            className="w-full"
            type="button"
            variant="outline"
            onClick={handleCancelFeishuSignIn}
          >
            取消飞书登录
          </Button>
        ) : null}

        {emailPasswordEnabled && feishuLoginEnabled ? (
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-foreground/10" />
            <span className="text-[12px] text-muted-foreground">或</span>
            <div className="h-px flex-1 bg-foreground/10" />
          </div>
        ) : null}

        {emailPasswordEnabled ? (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="client-auth-identifier">
                {usernameLoginEnabled ? '用户名或邮箱' : '邮箱'}
              </Label>
              <Input
                id="client-auth-identifier"
                autoComplete="username"
                autoFocus={!feishuLoginEnabled}
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder={usernameLoginEnabled ? 'zjding 或 email@example.com' : 'email@example.com'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="client-auth-password">密码</Label>
              <Input
                id="client-auth-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <Button className="w-full" type="submit" disabled={submitting || feishuSubmitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              登录
            </Button>
          </form>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen items-center justify-center px-6 py-10">
        {children}
      </div>
    </div>
  )
}

function AuthStatus({
  tone,
  title,
  description,
}: {
  tone: 'error'
  title: string
  description: string
}) {
  return (
    <div className="flex w-full max-w-[420px] gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-4 text-destructive">
      <AlertCircle className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <h1 className="text-sm font-semibold leading-5">{title}</h1>
        <p className="mt-1 break-words text-[13px] leading-5 opacity-90">{description}</p>
      </div>
    </div>
  )
}

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '未知错误'

  return message
    .replace(/^Error invoking remote method '[^']+':\s*/u, '')
    .replace(/^Error:\s*/u, '')
}
