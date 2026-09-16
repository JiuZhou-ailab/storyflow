# Model Access

Model Access defines who owns authentication state for managed and user-configured model connections.

## Language

**Identity Session**:
The bounded, individually revocable relationship between one local Storyflow installation and a provider-qualified signed-in account. It may be persisted for restart; renewing it does not extend its original lifetime.
_Avoid_: Model credential, provider API key

**Account Access**:
Storyflow's current permission to use managed capabilities and models, owned independently of the login provider. Disabling access revokes existing Identity Sessions; enabling it permits a fresh login.
_Avoid_: Login provider, subscription tier, organization membership

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
One logical assistant generation, including Pi-owned retries and at most one compatible model substitution within the configured native retry budget. A successful tool-use boundary closes this call; tool-result continuation starts another.
_Avoid_: HTTP request, user turn

**Transport Attempt**:
One outbound provider request within a Model Call. Attempts share a model-call identifier and use a zero-based attempt index.
_Avoid_: SDK retry budget, duplicate user message

## Relationships

- Feishu's tenant allowlist and verified, non-banned Neon email identities are independent admission boundaries; Neon organization invitations are not required.
- Provider-qualified identities remain distinct even when their email matches; login does not reset Account Access.
- Feishu or Neon proves identity when Storyflow creates the Identity Session; routine capability renewal requires the bounded Storyflow session and current Account Access. Storyflow access changes are independent of later identity-provider administration.
- Managed Model Access authorizes only trusted Storyflow-managed connections and remains transient. The host accepts or renews it before an Agent operation and never rotates it inside the operation.
- Each new managed resource operation requires both its capability and current Account Access; a successfully revoked session cannot authorize subsequent operations.
- Provider Credentials remain independent so user-configured providers continue to work without an Identity Session.
- Connection readiness is evaluated at the connection boundary, separately from Credential Store Health.
- Pi owns retry classification, backoff, and the configured per-call budget; transport correlation also counts any native provider retries.
- Managed Model Access refresh never replays a user turn. A rejected capability is renewed for the next explicit operation.
