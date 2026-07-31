// input: Provider selection product-mode metadata
// output: Tests for the formal two-mode onboarding provider entry
// pos: Guards the first-run model setup surface from drifting back to a provider marketplace

import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { PROVIDER_CHOICE_IDS } from "../provider-options"

const apiSetupSource = readFileSync(new URL("../APISetupStep.tsx", import.meta.url), "utf8")
const credentialsSource = readFileSync(new URL("../CredentialsStep.tsx", import.meta.url), "utf8")
const providerSelectSource = readFileSync(new URL("../ProviderSelectStep.tsx", import.meta.url), "utf8")

describe("ProviderSelectStep choices", () => {
  it("offers only managed default and custom provider modes", () => {
    expect(PROVIDER_CHOICE_IDS).toEqual(["managed_default", "custom_provider"])
    expect(providerSelectSource).toContain("name: 'Storyflow 托管模型'")
    expect(providerSelectSource).not.toContain("JiuZhou")
  })

  it("keeps managed default selection out of user credential surfaces", () => {
    expect(apiSetupSource).not.toContain("id: 'managed_default'")
    expect(credentialsSource).not.toContain("./managed-defaults")
  })
})
