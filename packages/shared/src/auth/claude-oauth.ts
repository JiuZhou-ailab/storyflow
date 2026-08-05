// input: Claude OAuth start/cancel/code submission from the product host
// output: Pi-issued Anthropic OAuth credentials without product-owned PKCE or token exchange
// pos: Two-step RPC bridge into Pi AuthStorage.login()

import { AuthStorage } from '@earendil-works/pi-coding-agent'

const PROVIDER_ID = 'anthropic'
const FLOW_TTL_MS = 10 * 60 * 1000

export interface ClaudeTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

interface PendingFlow {
  authUrl: Promise<string>
  completion: Promise<ClaudeTokens>
  expiresAt: number
  codeSubmitted: boolean
  cancelled: boolean
  submitCode(code: string): void
  cancel(): void
}

export interface PreparedClaudeOAuth {
  authUrl: string
  completion: Promise<ClaudeTokens>
  wasCodeSubmitted(): boolean
  wasCancelled(): boolean
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: Error): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createPendingFlow(): PendingFlow {
  const authStorage = AuthStorage.inMemory()
  const authUrl = deferred<string>()
  const authorizationCode = deferred<string>()
  const abortController = new AbortController()

  const login = authStorage.login(PROVIDER_ID, {
    onAuth: info => authUrl.resolve(info.url),
    onDeviceCode: () => {},
    onPrompt: () => authorizationCode.promise,
    onManualCodeInput: () => authorizationCode.promise,
    onSelect: async () => undefined,
    signal: abortController.signal,
  })
  void login.catch(error => {
    authUrl.reject(error instanceof Error ? error : new Error(String(error)))
  })

  const completion = login.then(() => {
    const credential = authStorage.get(PROVIDER_ID)
    if (credential?.type !== 'oauth') {
      throw new Error('Pi completed OAuth without returning Anthropic credentials')
    }
    return {
      accessToken: credential.access,
      refreshToken: credential.refresh,
      expiresAt: credential.expires,
    }
  })

  // Cancellation can reject after the start RPC has already returned. Keep the
  // completion observed until a handler consumes it.
  void completion.catch(() => {})

  const flow: PendingFlow = {
    authUrl: authUrl.promise,
    completion,
    expiresAt: Date.now() + FLOW_TTL_MS,
    codeSubmitted: false,
    cancelled: false,
    submitCode(code) {
      flow.codeSubmitted = true
      authorizationCode.resolve(code)
    },
    cancel() {
      flow.cancelled = true
      const error = new Error('OAuth flow cancelled')
      abortController.abort(error)
      authUrl.reject(error)
      authorizationCode.reject(error)
    },
  }
  return flow
}

let pendingFlow: PendingFlow | null = null

/** Start Pi's Anthropic login and expose its single completion to the RPC bridge. */
export async function prepareClaudeOAuth(): Promise<PreparedClaudeOAuth> {
  clearOAuthState()
  const flow = createPendingFlow()
  pendingFlow = flow
  try {
    const authUrl = await flow.authUrl
    let expiryTimer: ReturnType<typeof setTimeout>
    const completion = flow.completion.finally(() => {
      clearTimeout(expiryTimer)
      if (pendingFlow === flow) pendingFlow = null
    })
    expiryTimer = setTimeout(() => {
      if (pendingFlow === flow) clearOAuthState()
    }, FLOW_TTL_MS)
    // Automatic callback completion may settle without exchangeClaudeCode().
    void completion.catch(() => {})
    flow.completion = completion
    return {
      authUrl,
      completion,
      wasCodeSubmitted: () => flow.codeSubmitted,
      wasCancelled: () => flow.cancelled,
    }
  } catch (error) {
    if (pendingFlow === flow) pendingFlow = null
    throw error
  }
}

export function hasValidOAuthState(): boolean {
  if (!pendingFlow) return false
  if (Date.now() < pendingFlow.expiresAt) return true
  clearOAuthState()
  return false
}

export function clearOAuthState(): void {
  pendingFlow?.cancel()
  pendingFlow = null
}

/** Complete the pending Pi login with the code copied from the browser. */
export async function exchangeClaudeCode(authorizationCode: string): Promise<ClaudeTokens> {
  const flow = pendingFlow
  if (!flow || !hasValidOAuthState()) {
    throw new Error('OAuth session expired. Please start again.')
  }

  const code = authorizationCode.trim()
  if (!code) throw new Error('Authorization code is required')
  flow.submitCode(code)
  return flow.completion
}
