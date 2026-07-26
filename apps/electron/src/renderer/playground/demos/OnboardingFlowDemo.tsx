// input: Simulated onboarding choices and credential actions
// output: Interactive managed-default or custom-provider onboarding demo
// pos: Playground-only walkthrough of the production onboarding state flow

/**
 * OnboardingFlowDemo — Interactive walkthrough of the new onboarding flow.
 *
 * Manages its own state so you can click through the entire sequence
 * in the playground without needing real IPC or OAuth.
 *
 * Flow: WelcomeStep → ProviderSelectStep → CredentialsStep → CompletionStep
 */
import { useState, useCallback, useEffect } from 'react'
import { ensureMockElectronAPI } from '../mock-utils'
import { WelcomeStep } from '@/components/onboarding/WelcomeStep'
import { ProviderSelectStep, type ProviderChoice } from '@/components/onboarding/ProviderSelectStep'
import { CredentialsStep } from '@/components/onboarding/CredentialsStep'
import { CompletionStep } from '@/components/onboarding/CompletionStep'
import type { CredentialSetupMethod } from '@/components/onboarding/APISetupStep'
import type { CredentialStatus } from '@/components/onboarding/CredentialsStep'

type DemoStep = 'welcome' | 'provider-select' | 'credentials' | 'complete'

export function OnboardingFlowDemo() {
  useEffect(() => { ensureMockElectronAPI() }, [])

  const [step, setStep] = useState<DemoStep>('welcome')
  const [method, setMethod] = useState<CredentialSetupMethod | null>(null)
  const [credStatus, setCredStatus] = useState<CredentialStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()

  // Track history for the step indicator
  const [providerChoice, setProviderChoice] = useState<ProviderChoice | null>(null)

  const handleProviderSelect = useCallback((choice: ProviderChoice) => {
    setProviderChoice(choice)
    setCredStatus('idle')
    setErrorMessage(undefined)

    if (choice === 'jiuzhou') {
      setMethod(null)
      setStep('complete')
      return
    }

    setMethod('pi_api_key')
    setStep('credentials')
  }, [])

  const handleBack = useCallback(() => {
    switch (step) {
      case 'provider-select':
        setStep('welcome')
        break
      case 'credentials':
        setStep('provider-select')
        setCredStatus('idle')
        setErrorMessage(undefined)
        break
    }
  }, [step])

  const simulateOAuthSuccess = useCallback(() => {
    setCredStatus('validating')
    setTimeout(() => {
      setCredStatus('success')
      setTimeout(() => setStep('complete'), 600)
    }, 1500)
  }, [])

  const simulateApiKeySubmit = useCallback(() => {
    setCredStatus('validating')
    setTimeout(() => {
      setCredStatus('success')
      setTimeout(() => setStep('complete'), 600)
    }, 1200)
  }, [])

  const handleRestart = useCallback(() => {
    setStep('welcome')
    setMethod(null)
    setProviderChoice(null)
    setCredStatus('idle')
    setErrorMessage(undefined)
  }, [])

  const handleSkip = useCallback(() => {
    console.log('[Playground] Setup deferred — dismissing onboarding')
    // In the real app this calls onComplete() which dismisses onboarding
    // and shows the main app. In the playground we restart the demo.
    handleRestart()
  }, [handleRestart])

  // Step labels for the breadcrumb
  const STEP_ORDER: { key: DemoStep; label: string }[] = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'provider-select', label: 'Provider' },
    { key: 'credentials', label: 'Credentials' },
    { key: 'complete', label: 'Done' },
  ]

  const currentIndex = STEP_ORDER.findIndex(s => s.key === step)

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-foreground/[0.03] border-b border-border">
        <div className="flex items-center gap-1 text-xs">
          {STEP_ORDER.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/40 mx-1">→</span>}
              <span
                className={
                  i === currentIndex
                    ? 'font-semibold text-foreground'
                    : i < currentIndex
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/40'
                }
              >
                {s.label}
              </span>
            </span>
          ))}
        </div>
        <button
          onClick={handleRestart}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-foreground/5"
        >
          Restart
        </button>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center p-8 bg-foreground-2 overflow-auto">
        {step === 'welcome' && (
          <WelcomeStep
            isExistingUser={false}
            onContinue={() => setStep('provider-select')}
          />
        )}

        {step === 'provider-select' && (
          <ProviderSelectStep onSelect={handleProviderSelect} onSkip={handleSkip} />
        )}

        {step === 'credentials' && method && (
          <CredentialsStep
            apiSetupMethod={method}
            status={credStatus}
            errorMessage={errorMessage}
            onSubmit={simulateApiKeySubmit}
            onStartOAuth={simulateOAuthSuccess}
            onBack={handleBack}
            isWaitingForCode={false}
            onSubmitAuthCode={() => simulateOAuthSuccess()}
            onCancelOAuth={handleBack}
            copilotDeviceCode={
              method === 'pi_copilot_oauth' && credStatus === 'validating'
                ? { userCode: 'DEMO-1234', verificationUri: 'https://github.com/login/device' }
                : undefined
            }
          />
        )}

        {step === 'complete' && (
          <CompletionStep
            status="complete"
            onFinish={handleRestart}
          />
        )}
      </div>
    </div>
  )
}
