# Invite-only Email Authentication

## Decision

Keep Feishu OAuth unchanged. Use Neon Auth email/password, email OTP, and native
Organization invitations as the complete external-user identity and admission
system. The Auth Broker verifies signed Organization claims and issues existing
Storyflow capabilities. Cloudflare hosts the Broker and first-party domain; it
does not duplicate users, invitations, or memberships.

No custom admission database, invitation-code table, invitation CLI, account
linking layer, or authorization framework is introduced.

## Runtime flow

1. An Organization owner invites the external email through Neon Auth.
2. The user registers with that email and verifies the six-digit OTP.
3. Electron signs in, accepts the matching pending native invitation, activates
   the configured Organization, and requests a fresh Neon JWT.
4. The Broker accepts the exchange only when signed `o.id` matches
   `CRAFT_WEBUI_NEON_AUTH_ORGANIZATION_ID`.
5. Electron stores the Better Auth session cookie in the existing encrypted
   credential store; it never reaches renderer code.
6. Every Neon capability renewal obtains a fresh provider JWT, so removed
   Organization members cannot renew. Already-issued model access expires after
   15 minutes.

Feishu keeps its existing tenant allowlist and `pro` tier. Neon Organization
members receive the existing `standard` tier.

## Deployment

1. Create the production Neon Organization and enable native invitation email.
2. Set the same Organization ID in the public desktop build variable
   `CRAFT_CLIENT_NEON_AUTH_ORGANIZATION_ID` and Broker variable
   `CRAFT_WEBUI_NEON_AUTH_ORGANIZATION_ID`.
3. Create at least one pending production invitation before enabling desktop
   sign-up, and verify the Broker rejects users without Organization claims.
4. Deploy the Broker, then publish a desktop build with sign-up enabled. The
   invited-user QA covers OTP verification, invitation acceptance, restart,
   renewal, and revoked-member rejection.

Rollback disables the desktop sign-up switch and rolls back the Worker version.
Feishu and existing provider credentials are unaffected.
