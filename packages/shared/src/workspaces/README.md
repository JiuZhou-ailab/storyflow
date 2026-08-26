# Workspaces

Workspace storage, Host Project registration, project-owned paths, and the hidden Workspace used by Free Conversations. `storage.ts` owns directory persistence, `project-registry.ts` is the only local Project registration entry, Host config persistence never initializes roots, `paths.ts` owns canonical boundaries/rebasing, and `application-context.ts` is the only `workspaceId → Workspace` resolver.
