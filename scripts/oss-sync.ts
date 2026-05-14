// input: Request to run the repository OSS sync workflow
// output: Explicit unsupported-workflow failure instead of a missing module error
// pos: Placeholder maintenance entry until the OSS sync process is reintroduced

console.error("OSS sync is not implemented in this repository snapshot.");
console.error("Restore scripts/oss-sync.ts with the project-specific sync rules before using `bun run oss:sync`.");
process.exit(1);
