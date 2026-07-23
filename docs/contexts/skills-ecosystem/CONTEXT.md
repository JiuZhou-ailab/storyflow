# Skills Ecosystem

The Skills Ecosystem lets people publish and install project-owned experience while Storyflow retains control of host behavior and project state. Global Agent resources remain application-owned and are combined with project resources by the shared Resource Resolver.

## Language

**Skill Package**:
The versioned, installable product distributed by the Market into one Project Resource Overlay. It contains one Agent Skill, optional Workspace Contributions, and publication metadata.
_Avoid_: Skill, plugin, extension

**Agent Skill**:
The Pi-readable method and instructions contained in `SKILL.md`; it influences Agent reasoning and actions but does not directly control Storyflow UI.
_Avoid_: Plugin, workflow engine

**Global Agent Skill**:
An Agent Skill stored in the Global Resource Root and visible to every Runtime Domain.
_Avoid_: Bundled project Skill, copied workspace Skill

**Project Agent Skill**:
An Agent Skill stored in `<project>/.pi/skills/` and visible only through that project's Project Resource Overlay.
_Avoid_: Global Skill, Extension

**Workspace Contribution**:
A declarative request from a Skill Package for host-owned workspace capabilities such as project layout, templates, views, or required Sources.
_Avoid_: UI plugin, sidebar code, host command

**Skill Market**:
The catalog and governance boundary for discovering, publishing, versioning, reviewing, and distributing Skill Packages.
_Avoid_: Runtime, execution host
