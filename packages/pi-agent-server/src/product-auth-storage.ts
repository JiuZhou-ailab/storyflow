// input: Initial product credentials and Pi AuthStorage lock callbacks
// output: Process-local serialized storage that reports every credential rotation
// pos: Product persistence adapter for Pi-owned OAuth refresh

import type { AuthStorageBackend } from '@earendil-works/pi-coding-agent';

type LockResult<T> = { result: T; next?: string };

export class ProductAuthStorageBackend implements AuthStorageBackend {
  private value: string;
  private asyncTail: Promise<void> = Promise.resolve();
  private pendingAsync = 0;

  constructor(
    initialValue: string,
    private readonly onChange: (next: string) => void,
  ) {
    this.value = initialValue;
  }

  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
    if (this.pendingAsync > 0) {
      throw new Error('Cannot synchronously update auth storage while OAuth refresh is active');
    }
    const { result, next } = fn(this.value);
    if (next !== undefined) this.commit(next);
    return result;
  }

  async withLockAsync<T>(
    fn: (current: string | undefined) => Promise<LockResult<T>>,
  ): Promise<T> {
    this.pendingAsync += 1;
    const previous = this.asyncTail;
    let release!: () => void;
    this.asyncTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const { result, next } = await fn(this.value);
      if (next !== undefined) this.commit(next);
      return result;
    } finally {
      this.pendingAsync -= 1;
      release();
    }
  }

  private commit(next: string): void {
    this.value = next;
    this.onChange(next);
  }
}
