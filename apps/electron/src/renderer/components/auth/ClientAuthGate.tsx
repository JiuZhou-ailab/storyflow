// input: Renderer startup and main-process client auth IPC
// output: Login gate that prevents the desktop App tree from mounting until authenticated
// pos: First renderer boundary before workspace/session UI initializes

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  LogIn,
  Mail,
  MessageSquareText,
  ShieldCheck,
  UserPlus,
} from 'lucide-react'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { Info_Alert } from '@/components/info/Info_Alert'
import { SettingsCard, SettingsCardContent } from '@/components/settings/SettingsCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { ClientAuthState } from '../../../shared/types'

const AUTH_MOTION_EASE = [0.16, 1, 0.3, 1] as const

type EmailAuthMode = 'sign-in' | 'sign-up'

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

  // While the auth gate blocks the App tree, useWindowCloseHandler (mounted inside App)
  // is absent — so nothing answers the main process's CLOSE_REQUESTED ping and the window
  // only closes after the 3s fallback timeout (the "close is laggy" symptom). The gate has
  // no modals/panels, so confirm the close immediately for any source.
  const gateActive = loadError != null || !state || (state.required && !state.authenticated)
  useEffect(() => {
    if (!gateActive) return
    return window.electronAPI?.onCloseRequested?.(() => {
      window.electronAPI?.confirmCloseWindow?.()
    })
  }, [gateActive])

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
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authMode, setAuthMode] = useState<EmailAuthMode>('sign-in')
  const [error, setError] = useState<string | null>(null)
  const [registrationNotice, setRegistrationNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [feishuSubmitting, setFeishuSubmitting] = useState(false)
  const prefersReducedMotion = useReducedMotion()
  const authPanelMotion = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 10, scale: 0.99 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.22, ease: AUTH_MOTION_EASE },
      }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setRegistrationNotice(null)

    if (authMode === 'sign-up' && password !== confirmPassword) {
      setSubmitting(false)
      setError('两次输入的密码不一致')
      return
    }

    try {
      if (authMode === 'sign-up') {
        const result = await window.electronAPI.signUpClient({
          identifier,
          password,
          name: displayName,
        })
        if (result.status === 'verification-required') {
          setPassword('')
          setConfirmPassword('')
          setRegistrationNotice('账号已创建，请先完成邮箱验证，然后返回此处登录。')
          return
        }
      } else {
        await window.electronAPI.signInClient({ identifier, password })
      }

      await onSignedIn()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  function switchAuthMode(nextMode: EmailAuthMode) {
    setAuthMode(nextMode)
    setError(null)
    setRegistrationNotice(null)
    setPassword('')
    setConfirmPassword('')
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

  const authMethods = [
    emailPasswordEnabled ? (usernameLoginEnabled ? '邮箱 / 用户名' : '邮箱') : null,
    feishuLoginEnabled ? '飞书' : null,
  ].filter(Boolean).join(' · ')
  const formTitle = authMode === 'sign-up' ? '创建账号' : '登录账号'
  const identifierLabel = usernameLoginEnabled ? '用户名或邮箱' : '邮箱'

  return (
    <motion.section className="w-full max-w-[760px]" {...authPanelMotion}>
      <SettingsCard className="overflow-hidden border border-border/60 bg-background shadow-minimal" divided={false}>
        <SettingsCardContent className="p-0">
          <div className="grid min-h-[456px] grid-cols-[280px_minmax(0,1fr)] max-[720px]:grid-cols-1">
            <aside className="flex min-w-0 flex-col justify-between border-r border-border/60 bg-foreground-2 px-6 py-6 max-[720px]:gap-6 max-[720px]:border-b max-[720px]:border-r-0">
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-[10px] bg-background shadow-minimal">
                    <CraftAgentsSymbol className="size-6 text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Storyflow</p>
                    <h1 className="truncate text-[18px] font-semibold leading-6 text-foreground">桌面端访问</h1>
                  </div>
                </div>

                <div className="space-y-3">
                  <AuthContextRow icon={<ShieldCheck className="size-4" />} label="客户端鉴权" value="必需" />
                  <AuthContextRow icon={<Mail className="size-4" />} label="入口" value={authMethods || '不可用'} />
                  <AuthContextRow
                    icon={authMode === 'sign-up' ? <UserPlus className="size-4" /> : <LockKeyhole className="size-4" />}
                    label="模式"
                    value={authMode === 'sign-up' ? '新账号' : '已有账号'}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-background/70 p-3 shadow-minimal">
                <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
                  <CheckCircle2 className="size-4 text-success" />
                  工作区保持本地
                </div>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  认证通过后再加载会话与工作区。
                </p>
              </div>
            </aside>

            <div className="flex min-w-0 flex-col justify-center px-7 py-7 max-[720px]:px-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-[19px] font-semibold leading-6 text-foreground">{formTitle}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    {authMode === 'sign-up' ? '注册后继续进入桌面端。' : '验证身份后继续进入桌面端。'}
                  </p>
                </div>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground-2 shadow-minimal">
                  {authMode === 'sign-up' ? <UserPlus className="size-4 text-foreground/70" /> : <LogIn className="size-4 text-foreground/70" />}
                </div>
              </div>

              <div className="space-y-3">
                {emailPasswordEnabled ? (
                  <form className="space-y-3" onSubmit={handleSubmit}>
                    <div className="grid grid-cols-2 rounded-lg bg-foreground-2 p-1 shadow-minimal" role="tablist" aria-label="邮箱账号模式">
                      <AuthModeButton active={authMode === 'sign-in'} onClick={() => switchAuthMode('sign-in')}>
                        已有账号
                      </AuthModeButton>
                      <AuthModeButton active={authMode === 'sign-up'} onClick={() => switchAuthMode('sign-up')}>
                        创建账号
                      </AuthModeButton>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[13px]" htmlFor="client-auth-identifier">
                        {identifierLabel}
                      </Label>
                      <Input
                        id="client-auth-identifier"
                        autoComplete="username"
                        autoFocus
                        required
                        value={identifier}
                        onChange={(event) => setIdentifier(event.target.value)}
                        placeholder={usernameLoginEnabled ? 'zjding 或 email@example.com' : 'email@example.com'}
                      />
                    </div>

                    <AnimatePresence initial={false}>
                      {authMode === 'sign-up' ? (
                        <motion.div
                          className="space-y-1.5"
                          initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                          transition={{ duration: 0.16, ease: AUTH_MOTION_EASE }}
                        >
                          <Label className="text-[13px]" htmlFor="client-auth-name">名称</Label>
                          <Input
                            id="client-auth-name"
                            autoComplete="name"
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                            placeholder="你的名字"
                          />
                        </motion.div>
                      ) : null}
                    </AnimatePresence>

                    <div className={cn(
                      'grid gap-3',
                      authMode === 'sign-up' ? 'grid-cols-2 max-[560px]:grid-cols-1' : 'grid-cols-1'
                    )}>
                      <div className="space-y-1.5">
                        <Label className="text-[13px]" htmlFor="client-auth-password">密码</Label>
                        <Input
                          id="client-auth-password"
                          type="password"
                          autoComplete={authMode === 'sign-up' ? 'new-password' : 'current-password'}
                          required
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </div>

                      <AnimatePresence initial={false}>
                        {authMode === 'sign-up' ? (
                          <motion.div
                            className="space-y-1.5"
                            initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                            transition={{ duration: 0.16, ease: AUTH_MOTION_EASE }}
                          >
                            <Label className="text-[13px]" htmlFor="client-auth-confirm-password">确认密码</Label>
                            <Input
                              id="client-auth-confirm-password"
                              type="password"
                              autoComplete="new-password"
                              required={authMode === 'sign-up'}
                              value={confirmPassword}
                              onChange={(event) => setConfirmPassword(event.target.value)}
                            />
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>

                    <Button
                      className="h-9 w-full rounded-lg bg-background text-foreground shadow-minimal hover:bg-foreground/[0.04]"
                      type="submit"
                      disabled={submitting || feishuSubmitting}
                    >
                      {submitting
                        ? <Loader2 className="size-4 animate-spin" />
                        : authMode === 'sign-up'
                          ? <UserPlus className="size-4" />
                          : <LogIn className="size-4" />}
                      {authMode === 'sign-up' ? '创建账号' : '登录'}
                    </Button>
                  </form>
                ) : null}

                {emailPasswordEnabled && feishuLoginEnabled ? (
                  <div className="flex items-center gap-3 py-1">
                    <div className="h-px flex-1 bg-foreground/10" />
                    <span className="text-[12px] text-muted-foreground">或使用飞书</span>
                    <div className="h-px flex-1 bg-foreground/10" />
                  </div>
                ) : null}

                {feishuLoginEnabled ? (
                  <div className="space-y-2">
                    <Button
                      className={cn(
                        'h-9 w-full rounded-lg shadow-minimal',
                        emailPasswordEnabled
                          ? 'border-0 bg-foreground-2 hover:bg-foreground/[0.05]'
                          : 'bg-background text-foreground hover:bg-foreground/[0.04]'
                      )}
                      type="button"
                      variant={emailPasswordEnabled ? 'outline' : 'default'}
                      disabled={feishuSubmitting || submitting}
                      onClick={handleFeishuSignIn}
                    >
                      {feishuSubmitting ? <Loader2 className="size-4 animate-spin" /> : <MessageSquareText className="size-4" />}
                      使用飞书登录
                    </Button>

                    <AnimatePresence initial={false}>
                      {feishuSubmitting ? (
                        <motion.div
                          initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                          transition={{ duration: 0.16, ease: AUTH_MOTION_EASE }}
                        >
                          <Button
                            className="h-9 w-full rounded-lg border-0 bg-foreground-2 shadow-minimal hover:bg-foreground/[0.05]"
                            type="button"
                            variant="outline"
                            onClick={handleCancelFeishuSignIn}
                          >
                            取消飞书登录
                          </Button>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                ) : null}

                <AnimatePresence initial={false}>
                  {registrationNotice ? (
                    <motion.div
                      initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                      transition={{ duration: 0.16, ease: AUTH_MOTION_EASE }}
                    >
                      <Info_Alert variant="info">
                        <Info_Alert.Description className="mt-0 break-words text-[13px] leading-5">
                          {registrationNotice}
                        </Info_Alert.Description>
                      </Info_Alert>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                  {error ? (
                    <motion.div
                      initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                      transition={{ duration: 0.16, ease: AUTH_MOTION_EASE }}
                    >
                      <Info_Alert variant="error" icon={<AlertCircle className="size-4" />}>
                        <Info_Alert.Description className="mt-0 break-words text-[13px] leading-5 text-destructive">
                          {error}
                        </Info_Alert.Description>
                      </Info_Alert>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </SettingsCardContent>
      </SettingsCard>
    </motion.section>
  )
}

function AuthModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        'h-8 rounded-[7px] text-[12px] font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-minimal'
          : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function AuthContextRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-foreground/60 shadow-minimal">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] leading-4 text-muted-foreground">{label}</p>
        <p className="truncate text-[13px] font-medium leading-5 text-foreground">{value}</p>
      </div>
    </div>
  )
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-foreground-2 text-foreground">
      <div className="titlebar-drag-region fixed left-0 right-0 top-0 z-titlebar h-[50px]">
        {/* macOS: the native traffic-light cluster sits at the top-left ({x:18,y:16}).
            A drag region covering it swallows clicks, so the window can't be closed.
            Carve out a no-drag zone to keep the close/minimize/zoom buttons clickable. */}
        <div className="titlebar-no-drag absolute left-0 top-0 h-full w-[80px]" />
      </div>
      <div className="flex min-h-screen items-center justify-center px-8 py-12 max-[720px]:px-4">
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
