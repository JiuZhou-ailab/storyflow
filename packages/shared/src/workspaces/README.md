# Workspaces

Workspace storage, Host Project registration and Pi cwd grants, project-owned paths, and the hidden Workspace used by Free Conversations. `storage.ts` owns directory persistence, `project-registry.ts` owns local registration and Host path grants, Host config persistence never initializes roots, `paths.ts` owns canonical boundaries/rebasing, and `application-context.ts` is the only `workspaceId → Workspace` resolver.
