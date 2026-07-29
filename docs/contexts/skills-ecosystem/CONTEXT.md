# Skills Ecosystem

The Skills Ecosystem lets people publish reusable experience while Storyflow retains control of host behavior and project state. Pi owns Skill discovery, validation, precedence, and symlink deduplication; Storyflow projects Pi's resolved catalog into its UI and tools.

## Language

**Skill Package**:
The versioned, installable product distributed by the Market into a selected user or project scope. It contains one Agent Skill, optional Workspace Contributions, and publication metadata.
_Avoid_: Skill, plugin, extension

**Agent Skill**:
The Pi-readable method and instructions contained in `SKILL.md`; it influences Agent reasoning and actions but does not directly control Storyflow UI.
_Avoid_: Plugin, workflow engine

**User Agent Skill**:
An Agent Skill discovered by Pi from a user-owned location such as `~/.pi/agent/skills` or `~/.agents/skills`; visible to every project unless shadowed by Pi precedence.
_Avoid_: Global Resource Root, Storyflow-only Skill

**Project Agent Skill**:
An Agent Skill discovered by Pi from `.pi/skills` or `.agents/skills` in the active project hierarchy; versionable with the project and scoped by its working directory.
_Avoid_: Workspace copy, hidden overlay

**Resolved Skill Catalog**:
Pi's winning Skill definitions plus validation and collision diagnostics for one working directory. This is the shared read model for the Agent runtime and Storyflow Skills UI.
_Avoid_: Merged Storyflow store, directory scan

**Workspace Contribution**:
A declarative request from a Skill Package for host-owned capabilities such as project layout, templates, views, or required Sources. It applies to the project where the Skill is invoked.
_Avoid_: UI plugin, sidebar code, host command

**Skill Market**:
The catalog and governance boundary for discovering, publishing, versioning, reviewing, and distributing Skill Packages.
_Avoid_: Runtime, execution host
