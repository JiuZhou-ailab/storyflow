// input: Client authentication state, workspace list, and account actions
// output: Factual account management surface opened from user avatar actions
// pos: Renderer account-management layer outside startup and workspace/session routing

import { useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Building2,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  UserCircle,
} from 'lucide-react'

import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { SettingsCard, SettingsCardContent } from '@/components/settings/SettingsCard'
import { Button } from '@/components/ui/button'
import type { ClientAuthState, ClientAuthUser, Workspace } from '../../../shared/types'

interface AccountCenterPageProps {
  clientAuthState: ClientAuthState | null
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onBack: () => void
  onSignOut: () => Promise<void>
}

export function AccountCenterPage({
  clientAuthState,
  workspaces,
  activeWorkspaceId,
  onBack,
  onSignOut,
}: AccountCenterPageProps) {
  const [isSigningOut, setIsSigningOut] = useState(false)
  const user = clientAuthState?.user
  const displayName = getDisplayName(user)
  const email = user?.email ?? '未提供邮箱'
  const providerLabel = getProviderLabel(user?.provider)
  const activeWorkspace = activeWorkspaceId
    ? workspaces.find((workspace) => workspace.id === activeWorkspaceId)
    : null

  async function handleSignOut() {
    setIsSigningOut(true)
    try {
      await onSignOut()
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="min-h-full bg-foreground-2 text-foreground">
      <main className="mx-auto flex min-h-full w-full max-w-[760px] flex-col gap-5 px-6 py-6 max-[720px]:px-4">
        <header className="flex items-center justify-between gap-4 max-[720px]:items-start">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-background shadow-minimal">
              <CraftAgentsSymbol className="size-6 text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium leading-4 text-muted-foreground">Account</p>
              <h1 className="truncate text-[24px] font-semibold leading-8 text-foreground">账户</h1>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 rounded-lg px-3"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
            返回
          </Button>
        </header>

        <section>
          <SettingsCard className="border border-border/60 bg-background shadow-minimal" divided={false}>
            <SettingsCardContent className="flex flex-col gap-8 p-5">
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-foreground-2 text-foreground shadow-minimal">
                    <UserCircle className="size-8" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-[17px] font-semibold leading-6 text-foreground">{displayName}</h2>
                    <p className="truncate text-[12px] leading-5 text-muted-foreground">{email}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <AccountFact icon={<ShieldCheck className="size-4" />} label="登录方式" value={providerLabel} />
                  <AccountFact icon={<Mail className="size-4" />} label="邮箱状态" value={user?.emailVerified ? '已验证' : '未验证'} />
                  <AccountFact
                    icon={<Building2 className="size-4" />}
                    label="当前项目"
                    value={activeWorkspace?.name ?? (workspaces.length > 0 ? `${workspaces.length} 个项目` : '未选择')}
                  />
                </div>
              </div>

              <div className="border-t border-border/60 pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 justify-start rounded-lg text-muted-foreground hover:text-foreground"
                  disabled={isSigningOut}
                  onClick={handleSignOut}
                >
                  {isSigningOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                  退出登录
                </Button>
              </div>
            </SettingsCardContent>
          </SettingsCard>
        </section>
      </main>
    </div>
  )
}

function AccountFact({
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
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground-2 text-foreground/60">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] leading-4 text-muted-foreground">{label}</p>
        <p className="truncate text-[13px] font-medium leading-5 text-foreground">{value}</p>
      </div>
    </div>
  )
}

function getDisplayName(user: ClientAuthUser | undefined): string {
  return user?.name?.trim() || user?.email?.trim() || user?.userId || '本地用户'
}

function getProviderLabel(provider: ClientAuthUser['provider'] | undefined): string {
  switch (provider) {
    case 'feishu':
      return '飞书'
    case 'neon':
      return '邮箱 / 用户名'
    default:
      return '本地访问'
  }
}
