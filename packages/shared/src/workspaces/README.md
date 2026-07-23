# Workspaces

Workspace storage, project-owned paths, and the hidden Workspace used by Free Conversations. `storage.ts` owns project persistence, `paths.ts` owns canonical boundaries, and `application-context.ts` is the only `workspaceId → Workspace` resolver.
