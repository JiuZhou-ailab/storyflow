// input: Onboarding provider choice state and translations
// output: Managed or custom provider selection UI
// pos: First provider-selection step in desktop onboarding

import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Key } from "lucide-react"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout } from "./primitives"
import type { ProviderChoice } from "./provider-options"

export type { ProviderChoice } from "./provider-options"

interface ProviderOption {
  id: ProviderChoice
  name: string
  description: string
  icon: React.ReactNode
}

const PROVIDER_ICONS: Record<ProviderChoice, React.ReactNode> = {
  managed_default: <CraftAgentsSymbol className="size-5 text-accent" />,
  custom_provider: <Key className="size-5" />,
}

interface ProviderSelectStepProps {
  /** Called when the user selects a provider */
  onSelect: (choice: ProviderChoice) => void
  /** Called when the user chooses to skip setup */
  onSkip?: () => void
  errorMessage?: string
}

/**
 * ProviderSelectStep — First screen after install.
 *
 * Welcomes the user and asks them to pick their subscription / auth method.
 * Selecting a card immediately advances to the next step.
 */
export function ProviderSelectStep({ onSelect, onSkip, errorMessage }: ProviderSelectStepProps) {
  const { t } = useTranslation()

  const PROVIDER_OPTIONS = [
    {
      id: 'managed_default',
      name: 'Storyflow 托管模型',
      description: '使用内置托管模型，普通用户无需配置 provider。',
      icon: PROVIDER_ICONS.managed_default,
    },
    {
      id: 'custom_provider',
      name: t("onboarding.providerSelect.otherProvider"),
      description: '配置自己的 endpoint、API Key 和模型，支持兼容协议。',
      icon: PROVIDER_ICONS.custom_provider,
    },
  ] satisfies ProviderOption[]

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      }
      title={t("onboarding.providerSelect.title")}
      description={t("onboarding.providerSelect.description")}
    >
      <div className="space-y-3">
        {PROVIDER_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => onSelect(option.id)}
            className={cn(
              "flex w-full items-start gap-4 rounded-xl bg-foreground-2 p-4 text-left transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "hover:bg-foreground/[0.02] shadow-minimal",
            )}
          >
            {/* Icon */}
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {option.icon}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm">{option.name}</span>
              <p className="mt-0 text-xs text-muted-foreground">
                {option.description}
              </p>
            </div>
          </button>
        ))}
      </div>

      {errorMessage && (
        <div className="mt-4 rounded-lg bg-destructive/10 text-destructive text-sm p-3">
          {errorMessage}
        </div>
      )}

      {onSkip && (
        <div className="mt-4 text-center">
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("onboarding.providerSelect.setupLater")}
          </button>
        </div>
      )}
    </StepFormLayout>
  )
}
