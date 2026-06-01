// input: Client authentication state, workspace list, and account actions
// output: Account and points management surface opened from user avatar actions
// pos: Renderer account-management layer outside startup and workspace/session routing

import { useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CircleDashed,
  Coins,
  CreditCard,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  UserCircle,
  WalletCards,
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
      <main className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col gap-5 px-6 py-6 max-[720px]:px-4">
        <header className="flex items-center justify-between gap-4 max-[720px]:items-start">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-background shadow-minimal">
              <CraftAgentsSymbol className="size-6 text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium leading-4 text-muted-foreground">Account</p>
              <h1 className="truncate text-[24px] font-semibold leading-8 text-foreground">账户中心</h1>
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

        <section className="grid min-h-0 grid-cols-[320px_minmax(0,1fr)] gap-4 max-[900px]:grid-cols-1">
          <SettingsCard className="border border-border/60 bg-background shadow-minimal" divided={false}>
            <SettingsCardContent className="flex h-full flex-col justify-between gap-8 p-5">
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
            </SettingsCardContent>
          </SettingsCard>

          <div className="grid min-w-0 gap-4">
            <div className="grid grid-cols-3 gap-3 max-[720px]:grid-cols-1">
              <AccountMetric
                icon={<Coins className="size-4" />}
                label="积分余额"
                value="—"
                note="待同步"
              />
              <AccountMetric
                icon={<CreditCard className="size-4" />}
                label="订阅"
                value="本地版"
                note="待同步"
              />
              <AccountMetric
                icon={<BadgeCheck className="size-4" />}
                label="身份状态"
                value={clientAuthState?.authenticated ? '已登录' : '未登录'}
                note={clientAuthState?.required ? '需要认证' : '本地访问'}
              />
            </div>

            <SettingsCard className="border border-border/60 bg-background shadow-minimal" divided={false}>
              <SettingsCardContent className="p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[16px] font-semibold leading-6 text-foreground">积分与权益</h2>
                    <p className="text-[12px] leading-5 text-muted-foreground">
                      积分与订阅信息会随账户服务同步；未返回的数据保持为空。
                    </p>
                  </div>
                  <WalletCards className="size-5 shrink-0 text-muted-foreground" />
                </div>

                <div className="grid gap-2">
                  <AccountEntitlement label="AI 创作积分" value="待同步" />
                  <AccountEntitlement label="模型权益" value="跟随当前项目配置" />
                  <AccountEntitlement label="远端协作" value={workspaces.some((workspace) => workspace.remoteServer) ? '已配置远端项目' : '未配置'} />
                </div>
              </SettingsCardContent>
            </SettingsCard>
          </div>
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

function AccountMetric({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode
  label: string
  value: string
  note: string
}) {
  return (
    <SettingsCard className="border border-border/60 bg-background shadow-minimal" divided={false}>
      <SettingsCardContent className="p-4">
        <div className="mb-4 flex size-8 items-center justify-center rounded-lg bg-foreground-2 text-foreground/70">
          {icon}
        </div>
        <p className="text-[12px] font-medium leading-5 text-muted-foreground">{label}</p>
        <p className="mt-1 truncate text-[20px] font-semibold leading-7 text-foreground">{value}</p>
        <p className="mt-1 inline-flex items-center gap-1 text-[12px] leading-5 text-muted-foreground">
          <CircleDashed className="size-3.5" />
          {note}
        </p>
      </SettingsCardContent>
    </SettingsCard>
  )
}

function AccountEntitlement({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 border-b border-border/50 py-3 text-[13px] last:border-b-0 max-[560px]:grid-cols-1 max-[560px]:gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground">{value}</span>
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
