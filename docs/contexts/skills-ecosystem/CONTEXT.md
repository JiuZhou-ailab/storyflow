# Skills Ecosystem

The Skills Ecosystem lets people publish reusable experience while Storyflow retains control of host behavior and project state. Every installed Skill has one global definition; projects supply invocation context, not a second Skill scope.

## Language

**Skill Package**:
The versioned, installable product distributed by the Market into the Global Resource Root. It contains one Agent Skill, optional Workspace Contributions, and publication metadata.
_Avoid_: Skill, plugin, extension

**Agent Skill**:
The Pi-readable method and instructions contained in `SKILL.md`; it influences Agent reasoning and actions but does not directly control Storyflow UI.
_Avoid_: Plugin, workflow engine

**Global Agent Skill**:
An Agent Skill stored in the Global Resource Root, identified only by its global slug, and visible to every Runtime Domain. Project identity is invocation context, not part of Skill identity.
_Avoid_: Project Skill, copied workspace Skill

**Workspace Contribution**:
A declarative request from a global Skill Package for host-owned capabilities such as project layout, templates, views, or required Sources. It applies to the project where the Skill is invoked.
_Avoid_: UI plugin, sidebar code, host command

**Skill Market**:
The catalog and governance boundary for discovering, publishing, versioning, reviewing, and distributing Skill Packages.
_Avoid_: Runtime, execution host
