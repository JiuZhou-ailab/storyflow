// input: Renderer startup and main-process client auth IPC
// output: Reusable managed-account login surface
// pos: Renderer authentication UI used at managed capability boundaries

import { useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  AlertCircle,
  Loader2,
  LockKeyhole,
  LogIn,
  MessageSquareText,
  UserPlus,
} from 'lucide-react'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { Info_Alert } from '@/components/info/Info_Alert'
import { SettingsCard, SettingsCardContent } from '@/components/settings/SettingsCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const AUTH_MOTION_EASE = [0.16, 1, 0.3, 1] as const

type EmailAuthMode = 'sign-in' | 'sign-up'

export function ClientSignInForm({
  emailPasswordEnabled,
  emailSignUpEnabled,
  feishuLoginEnabled,
  usernameLoginEnabled,
  onSignedIn,
}: {
  emailPasswordEnabled: boolean
  emailSignUpEnabled: boolean
  feishuLoginEnabled: boolean
  usernameLoginEnabled: boolean
  onSignedIn: () => Promise<void>
}) {
  const [identifier, setIdentifier] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null)
  const [otp, setOtp] = useState('')
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

  useEffect(() => {
    if (!emailSignUpEnabled && authMode === 'sign-up') {
      setAuthMode('sign-in')
      setRegistrationNotice(null)
      setError(null)
    }
  }, [authMode, emailSignUpEnabled])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setRegistrationNotice(null)

    if (authMode === 'sign-up' && !emailSignUpEnabled) {
      setSubmitting(false)
      setError('邮箱注册未开放')
      return
    }

    if (authMode === 'sign-up' && password !== confirmPassword) {
      setSubmitting(false)
      setError('两次输入的密码不一致')
      return
    }

    try {
      if (verificationEmail) {
        await window.electronAPI.verifyClientEmail({ email: verificationEmail, otp })
        await window.electronAPI.signInClient({ identifier: verificationEmail, password })
        await onSignedIn()
        return
      }
      if (authMode === 'sign-up') {
        if (!identifier.trim().includes('@')) {
          setError('创建账号需要输入完整邮箱。')
          return
        }
        const result = await window.electronAPI.signUpClient({
          identifier,
          password,
          name: displayName,
        })
        if (result.status === 'verification-required') {
          setVerificationEmail(identifier.trim().toLowerCase())
          setRegistrationNotice('验证码已发送到注册邮箱，验证后将自动登录。')
          return
        }
      } else {
        await window.electronAPI.signInClient({ identifier, password })
      }

      await onSignedIn()
    } catch (err) {
      setError(formatClientAuthErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  function switchAuthMode(nextMode: EmailAuthMode) {
    if (nextMode === 'sign-up' && !emailSignUpEnabled) return
    setAuthMode(nextMode)
    setError(null)
    setRegistrationNotice(null)
    setPassword('')
    setConfirmPassword('')
    setVerificationEmail(null)
    setOtp('')
  }

  async function handleFeishuSignIn() {
    setFeishuSubmitting(true)
    setError(null)

    try {
      await window.electronAPI.signInWithFeishuClient()
      await onSignedIn()
    } catch (err) {
      setError(formatClientAuthErrorMessage(err))
    } finally {
      setFeishuSubmitting(false)
    }
  }

  async function handleCancelFeishuSignIn() {
    try {
      await window.electronAPI.cancelFeishuSignInClient()
    } catch (err) {
      setError(formatClientAuthErrorMessage(err))
    }
  }

  const formTitle = authMode === 'sign-up' && emailSignUpEnabled
    ? '创建 Storyflow 账号'
    : '登录 Storyflow'
  const formDescription = authMode === 'sign-up' && emailSignUpEnabled
    ? '注册后可使用 Storyflow 托管模型，本地项目不受影响。'
    : '登录后可使用 Storyflow 托管模型，本地项目不受影响。'
  const identifierLabel = authMode === 'sign-up'
    ? '邮箱'
    : usernameLoginEnabled ? '用户名或邮箱' : '邮箱'
  const identifierPlaceholder = authMode === 'sign-up'
    ? 'email@example.com'
    : usernameLoginEnabled ? 'zjding 或 email@example.com' : 'email@example.com'

  return (
    <motion.section className="w-full max-w-[420px]" {...authPanelMotion}>
      <SettingsCard className="border border-border/60 bg-background shadow-minimal" divided={false}>
        <SettingsCardContent className="p-6 max-[520px]:p-5">
          <header className="mb-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-foreground-2 shadow-minimal">
                <CraftAgentsSymbol className="size-6 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Storyflow
                </p>
                <h1 className="text-[19px] font-semibold leading-6 text-foreground">{formTitle}</h1>
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-5 text-muted-foreground">{formDescription}</p>
          </header>

          <div className="space-y-4">
            {emailPasswordEnabled ? (
              <form className="space-y-4" onSubmit={handleSubmit}>
                {emailSignUpEnabled ? (
                  <Tabs
                    value={authMode}
                    onValueChange={(value) => switchAuthMode(value === 'sign-up' ? 'sign-up' : 'sign-in')}
                  >
                    <TabsList className="grid w-full grid-cols-2 bg-foreground-2">
                      <TabsTrigger value="sign-in">已有账号</TabsTrigger>
                      <TabsTrigger value="sign-up">创建账号</TabsTrigger>
                    </TabsList>
                  </Tabs>
                ) : null}

                <div className="space-y-1.5">
                  <Label className="text-[13px]" htmlFor="client-auth-identifier">
                    {identifierLabel}
                  </Label>
                  <Input
                    id="client-auth-identifier"
                    type={authMode === 'sign-up' ? 'email' : 'text'}
                    autoComplete={authMode === 'sign-up' ? 'email' : 'username'}
                    autoFocus
                    required
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder={identifierPlaceholder}
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

                <AnimatePresence initial={false}>
                  {verificationEmail ? (
                    <motion.div
                      className="space-y-1.5"
                      initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                      transition={{ duration: 0.16, ease: AUTH_MOTION_EASE }}
                    >
                      <Label className="text-[13px]" htmlFor="client-auth-otp">邮箱验证码</Label>
                      <Input
                        id="client-auth-otp"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        value={otp}
                        onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      />
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                <Button
                  className="w-full"
                  type="submit"
                  disabled={submitting || feishuSubmitting}
                >
                  {submitting
                    ? <Loader2 className="size-4 animate-spin" />
                    : verificationEmail
                      ? <LogIn className="size-4" />
                      : authMode === 'sign-up'
                      ? <UserPlus className="size-4" />
                      : <LogIn className="size-4" />}
                  {verificationEmail ? '验证并登录' : authMode === 'sign-up' ? '创建账号' : '登录'}
                </Button>
              </form>
            ) : null}

            {emailPasswordEnabled && feishuLoginEnabled ? (
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border/70" />
                <span className="text-[12px] text-muted-foreground">或使用飞书</span>
                <div className="h-px flex-1 bg-border/70" />
              </div>
            ) : null}

            {feishuLoginEnabled ? (
              <div className="space-y-2">
                <Button
                  className="w-full"
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
                        className="w-full"
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

            <div className="flex items-start gap-2 border-t border-border/60 pt-4 text-[12px] leading-5 text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
              <p>登录仅用于验证账号，工作区仍保存在本机。</p>
            </div>
          </div>
        </SettingsCardContent>
      </SettingsCard>
    </motion.section>
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

function formatClientAuthErrorMessage(error: unknown): string {
  const message = getErrorMessage(error)
  if (message === 'Invalid email or password') {
    return '账号或密码不正确。没有账号请先创建账号。'
  }
  if (message === 'Email sign-up is disabled') {
    return '当前未开放邮箱注册。'
  }
  if (message === 'A full email address is required to create an account') {
    return '创建账号需要输入完整邮箱。'
  }
  if (message === 'Invitation required') {
    return '该邮箱尚未加入当前组织，请联系管理员确认邀请状态。'
  }
  if (message === 'Neon Auth session is required') return '登录状态已失效，请重新登录。'
  if (message === 'Invalid OTP' || message === 'INVALID_OTP') return '邮箱验证码不正确或已过期。'
  return message
}
