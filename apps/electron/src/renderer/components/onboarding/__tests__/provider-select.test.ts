// input: Provider selection product-mode metadata
// output: Tests for the formal two-mode onboarding provider entry
// pos: Guards the first-run model setup surface from drifting back to a provider marketplace

import { describe, expect, it } from "bun:test"
import { PROVIDER_CHOICE_IDS } from "../provider-options"

describe("ProviderSelectStep choices", () => {
  it("offers only managed default and custom provider modes", () => {
    expect(PROVIDER_CHOICE_IDS).toEqual(["jiuzhou", "custom_provider"])
  })
})
