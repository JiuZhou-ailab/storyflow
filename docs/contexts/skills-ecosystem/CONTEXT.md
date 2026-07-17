# Skills Ecosystem

The Skills Ecosystem lets people publish and install project-owned experience while Storyflow retains control of host behavior and project state.

## Language

**Skill Package**:
The versioned, installable product distributed by the Market. It contains one Agent Skill, optional Workspace Contributions, and publication metadata.
_Avoid_: Skill, plugin, extension

**Agent Skill**:
The Pi-readable method and instructions contained in `SKILL.md`; it influences Agent reasoning and actions but does not directly control Storyflow UI.
_Avoid_: Plugin, workflow engine

**Workspace Contribution**:
A declarative request from a Skill Package for host-owned workspace capabilities such as project layout, templates, views, or required Sources.
_Avoid_: UI plugin, sidebar code, host command

**Skill Market**:
The catalog and governance boundary for discovering, publishing, versioning, reviewing, and distributing Skill Packages.
_Avoid_: Runtime, execution host
