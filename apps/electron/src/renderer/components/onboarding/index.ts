// input: Onboarding step components and their public types
// output: Stable barrel exports for custom connection setup surfaces
// pos: Renderer onboarding component boundary

// Shared primitives for building step components
export {
  StepIcon,
  StepHeader,
  StepFormLayout,
  StepActions,
  BackButton,
  ContinueButton,
  type StepIconVariant,
} from './primitives'

// Individual steps
export { WelcomeStep } from './WelcomeStep'
export {
  APISetupStep,
  type ApiSetupMethod,
  type CredentialSetupMethod,
} from './APISetupStep'
export { CredentialsStep, type CredentialStatus } from './CredentialsStep'
export { CompletionStep } from './CompletionStep'
export { LocalModelStep, type LocalModelSubmitData } from './LocalModelStep'
export { GitBashWarning, type GitBashStatus } from './GitBashWarning'

// Main wizard container
export { OnboardingWizard, type OnboardingState, type OnboardingStep, type LoginStatus } from './OnboardingWizard'

// Re-export all types for convenient import
export type {
  OnboardingStep as OnboardingStepType,
  OnboardingState as OnboardingStateType,
} from './OnboardingWizard'

export type {
  ApiSetupMethod as ApiSetupMethodType,
} from './APISetupStep'

export type {
  CredentialStatus as CredentialStatusType,
} from './CredentialsStep'
