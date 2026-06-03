// input: Product model setup modes for onboarding
// output: Pure provider choice metadata that can be tested without UI assets
// pos: Boundary between formal two-mode model setup and React presentation

export type ProviderChoice = "jiuzhou" | "custom_provider"

export const PROVIDER_CHOICE_IDS = ["jiuzhou", "custom_provider"] as const satisfies readonly ProviderChoice[]
