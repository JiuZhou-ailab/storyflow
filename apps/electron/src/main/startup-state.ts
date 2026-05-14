// input: Electron main-process startup status flags
// output: Startup policy helpers for deciding whether UI windows may open
// pos: Keeps startup failure behavior testable outside Electron runtime

export interface StartupWindowPolicyInput {
  initSucceeded: boolean
  isHeadless: boolean
}

export function shouldCreateWindowsAfterStartup(input: StartupWindowPolicyInput): boolean {
  return input.initSucceeded && !input.isHeadless
}
