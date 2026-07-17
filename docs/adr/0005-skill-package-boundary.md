# Skill Packages separate Agent methods from host contributions

Storyflow distributes a user-facing Skill as a versioned Skill Package containing one Pi-readable Agent Skill, optional declarative Workspace Contributions, and publication metadata. Storyflow owns and interprets the supported host capabilities; arbitrary UI or runtime code is not a Skill and must use a separately designed extension boundary. This preserves Pi compatibility and community flexibility without turning every Skill installation into code execution inside the desktop host.
