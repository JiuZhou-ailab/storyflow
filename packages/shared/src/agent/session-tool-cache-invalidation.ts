// input: Browser-tool configuration changes and optional adapter cache hooks
// output: Runtime-neutral session-tool cache invalidation notifications
// pos: Decoupling seam between app config and legacy SDK-specific tool caches

let invalidator: (() => void) | undefined;

export function registerSessionToolCacheInvalidator(next: () => void): void {
  invalidator = next;
}

export function invalidateAllSessionToolsCaches(): void {
  invalidator?.();
}
