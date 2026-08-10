// input: Initial product credentials and Pi CredentialStore mutations
// output: Pi-native in-memory storage that reports every committed credential change
// pos: Product persistence listener for Pi-owned OAuth refresh

import {
  InMemoryCredentialStore,
  type AuthOperationOptions,
  type Credential,
} from '@earendil-works/pi-ai';

export class ProductCredentialStore extends InMemoryCredentialStore {
  private constructor(
    private readonly onChange: (providerId: string, credential: Credential | undefined) => void,
  ) {
    super();
  }

  static async create(
    initialCredentials: Readonly<Record<string, Credential>>,
    onChange: (providerId: string, credential: Credential | undefined) => void,
  ): Promise<ProductCredentialStore> {
    const store = new ProductCredentialStore(onChange);
    for (const [providerId, credential] of Object.entries(initialCredentials)) {
      await store.seed(providerId, credential);
    }
    return store;
  }

  override async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    let changed = false;
    const credential = await super.modify(providerId, async current => {
      const next = await fn(current);
      changed = next !== undefined;
      return next;
    }, options);
    if (changed) this.onChange(providerId, credential);
    return credential;
  }

  override async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    await super.delete(providerId, options);
    this.onChange(providerId, undefined);
  }

  private seed(providerId: string, credential: Credential): Promise<Credential | undefined> {
    return super.modify(providerId, async () => credential);
  }
}
