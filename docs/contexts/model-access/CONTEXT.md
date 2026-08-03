# Model Access

Model Access defines who owns authentication state for managed and user-configured model connections.

## Language

**Identity Session**:
The renewable relationship between a local Storyflow installation and a signed-in account. It may be persisted so the account can be restored after restart.
_Avoid_: Model credential, provider API key

**Managed Model Access**:
A short-lived capability derived from an Identity Session and supplied by the host only to Storyflow-managed model runtimes.
_Avoid_: Stored provider credential, default API key

**Provider Credential**:
User-owned authentication material for one user-configured model provider. Its lifecycle belongs to that provider connection.
_Avoid_: Managed account session, shared default credential

**Model Connection**:
Routing and model-selection metadata. It selects an authentication mechanism but does not own authentication state.
_Avoid_: Credential record, login session

**Credential Store Health**:
The ability to read and decrypt Provider Credentials. It says nothing about whether any Model Connection is currently usable.
_Avoid_: Default connection readiness, managed login status

**Model Call**:
One logical provider invocation, including at most one Pi-owned replay after a retryable failure.
_Avoid_: HTTP request, user turn

**Transport Attempt**:
One outbound provider request within a Model Call. Attempts share a model-call identifier and use a zero-based attempt index.
_Avoid_: SDK retry budget, duplicate user message

## Relationships

- An Identity Session may issue Managed Model Access; it is not copied into Provider Credentials.
- Managed Model Access authorizes only trusted Storyflow-managed connections and remains transient.
- Provider Credentials remain independent so user-configured providers continue to work without an Identity Session.
- Connection readiness is evaluated at the connection boundary, separately from Credential Store Health.
- Pi owns retry classification, backoff, and the single replay budget; provider SDK retries are disabled.
- Managed Model Access refresh may replay once after an authentication failure, but it is not a transport retry.
