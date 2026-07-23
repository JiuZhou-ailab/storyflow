# Context Map

## Contexts

- [Performance](./CONTEXT.md) — defines the measurement language and completion criteria for Storyflow performance work.
- [Runtime Domains](./docs/contexts/runtime-domains/CONTEXT.md) — defines the ownership and isolation language for application-level conversation and project work.
- [Skills Ecosystem](./docs/contexts/skills-ecosystem/CONTEXT.md) — defines the language for publishing, installing, composing, and governing project-owned Skills.

## Relationships

- **Runtime Domains → Skills Ecosystem**: each runtime domain selects which resource scopes are visible; the Skills Ecosystem defines project-owned Skill packages, not runtime ownership.
- **Skills Ecosystem → Project workspace**: installed packages contribute Agent methods and declarative workspace intent without owning project content.
- **Performance → Skills Ecosystem**: performance budgets constrain implementation choices but do not define Skills domain semantics.
