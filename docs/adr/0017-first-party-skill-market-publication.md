# ADR 0017: First-party Skill Market publication

## Status

Accepted.

## Context

Storyflow needs one native place where users can browse, publish, download,
and install Skills. The repository already contains a Cloudflare Worker, D1/R2
schema, strict single-Skill ResourceBundle validation, immutable downloads, and
desktop install deep links. Its contribution flow was frozen behind a separate
Cloudflare Access identity and an administrator-only pending queue, while the
desktop linked to SkillHub. The desktop also described project installation but
the RPC handler silently wrote Skills to the user directory.

The first release does not need human moderation, queues, social features, or a
general plugin runtime. It does need one identity chain, immutable distribution,
review failure semantics, and an install target that cannot be controlled by an
untrusted package.

## Decision

1. The existing `apps/skills-market` Worker becomes Storyflow's first-party
   catalog and distribution boundary. Pi remains the only Skill discovery and
   execution authority.
2. A Package Slug identifies the Market package and installed directory. It is
   independent from the Agent Skill `name` inside `SKILL.md`.
3. Desktop publication uses a five-minute token issued from the existing client
   session with audience `storyflow-skills-market` and scope `skills:publish`.
   Model-access tokens and signing keys are not reused.
4. Publication is synchronous: authenticate, bound and deterministically
   validate the package, run Automated Review, then publish the immutable version
   directly. Rejection writes nothing and returns `422`; unavailable or malformed
   review output writes nothing and returns `503`.
5. Approved bytes are written to a content-addressed R2 key before one D1 batch
   makes the version visible and current. Review evidence is stored with the
   published version.
6. Install scope is an explicit client decision. The content-creation flow uses
   `project`; a package or deep link can never provide a filesystem path or
   choose its install scope.
7. A publish action exports the selected winner from Pi's Resolved Skill Catalog.
   The renderer cannot submit an arbitrary local path as the package source.
8. The desktop Skills route is the product surface. The Worker exposes public
   catalog and download APIs, but does not maintain a second browser Studio or
   a separate Cloudflare Access identity.

## Consequences

- The administrator publish endpoint, pending queue, and review console are not
  part of the first release.
- Catalog, detail, and download APIs remain public. The native Skills Hub renders
  them alongside Pi's local catalog; desktop publication uses the Storyflow
  account identity.
- AI review is an admission signal, not proof of ownership, license, or safety.
  The UI presents license values as publisher declarations.
- Ratings, comments, payments, organizations, private registries, appeals,
  asynchronous review, automatic upgrades, and full-text search wait for measured
  demand.
