// input: Credential values, encrypted file, and OS machine identity
// output: Encrypted credential persistence with recoverable corrupt-file backups
// pos: File backend; preserves existing data when machine identity is unavailable

/**
 * Secure Storage Backend
 *
 * Stores credentials in an encrypted file at the active Craft config directory.
 * Uses AES-256-GCM for authenticated encryption.
 *
 * Encryption key is derived from OS-native hardware UUID using PBKDF2:
 * - macOS: IOPlatformUUID (tied to logic board, never changes)
 * - Windows: MachineGuid from registry (set at OS install)
 * - Linux: /var/lib/dbus/machine-id (set at OS install)
 *
 * This is more stable than the previous hostname-based derivation, which could
 * change with network/DHCP. Legacy credentials are auto-migrated on first load.
 *
 * File format:
 *   [Header - 64 bytes]
 *   ├── Magic: "CRAFT01\0" (8 bytes)
 *   ├── Flags: uint32 LE (4 bytes) - reserved for future use
 *   ├── Salt: 32 bytes (PBKDF2 salt)
 *   ├── Reserved: 20 bytes
 *   [Encrypted Payload]
 *   ├── IV: 12 bytes (random per write)
 *   ├── Auth Tag: 16 bytes (GCM authentication)
 *   └── Ciphertext: variable (encrypted JSON)
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  pbkdf2Sync,
  createHash,
} from 'crypto';
import { execSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync, renameSync, readdirSync, unlinkSync } from 'fs';
import { hostname, userInfo, homedir } from 'os';
import { join, dirname, basename } from 'path';

import type { CredentialBackend } from './types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';
import { credentialIdToAccount, accountToCredentialId } from '../types.ts';
import { CONFIG_DIR } from '../../config/paths.ts';
import { atomicWriteFileSync } from '../../utils/files.ts';

// File location
const CREDENTIALS_DIR = CONFIG_DIR;
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'credentials.enc');

// File format constants
const MAGIC_BYTES = Buffer.from('CRAFT01\0');
const HEADER_SIZE = 64;
const MAGIC_SIZE = 8;
const FLAGS_SIZE = 4;
const SALT_SIZE = 32;
const IV_SIZE = 12;
const AUTH_TAG_SIZE = 16;
const KEY_SIZE = 32;

// PBKDF2 iterations (balance security vs startup time)
const PBKDF2_ITERATIONS = 100000;

/**
 * Get stable machine identifier using OS-native hardware UUID.
 * This is far more stable than hostname which can change with network/DHCP.
 * Returns null when hardware UUID is unavailable; callers must preserve existing files.
 */
function getStableMachineId(): string | null {
  try {
    if (process.platform === 'darwin') {
      // macOS: IOPlatformUUID - tied to logic board, never changes
      const output = execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } else if (process.platform === 'win32') {
      // Windows: MachineGuid from registry - set at OS install
      const output = execSync(
        'reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      if (match?.[1]) return match[1];
    } else {
      // Linux: dbus machine-id - set at OS install
      const machineIdPath = '/var/lib/dbus/machine-id';
      const altPath = '/etc/machine-id';
      if (existsSync(machineIdPath)) {
        return readFileSync(machineIdPath, 'utf-8').trim() || null;
      } else if (existsSync(altPath)) {
        return readFileSync(altPath, 'utf-8').trim() || null;
      }
    }
  } catch {
    // Report unavailability at the backend boundary without logging command output.
  }

  return null;
}

/** Internal credential store structure */
interface CredentialStore {
  version: 1;
  credentials: Record<string, StoredCredential>;
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

export class SecureStorageBackend implements CredentialBackend {
  readonly name = 'secure-storage';
  readonly priority = 100;

  private cachedStore: CredentialStore | null = null;
  private stableMachineId: string | null = null;
  private encryptionKey: { cacheKey: string; key: Buffer } | null = null;
  private salt: Buffer | null = null;

  constructor(
    private readonly credentialsFile = CREDENTIALS_FILE,
    private readonly readMachineId: () => string | null = getStableMachineId,
  ) {}

  async isAvailable(): Promise<boolean> {
    // File backend is always available - we can always write to filesystem
    return true;
  }

  async get(id: CredentialId): Promise<StoredCredential | null> {
    const store = await this.loadStore();
    if (!store) return null;

    const key = credentialIdToAccount(id);
    return store.credentials[key] || null;
  }

  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    let store = await this.loadStore();

    if (!store) {
      // Initialize new store
      store = {
        version: 1,
        credentials: {},
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    }

    const key = credentialIdToAccount(id);
    await this.saveStore({
      ...store,
      credentials: { ...store.credentials, [key]: credential },
      metadata: { ...store.metadata, updatedAt: Date.now() },
    });
  }

  async delete(id: CredentialId): Promise<boolean> {
    const store = await this.loadStore();
    if (!store) return false;

    const key = credentialIdToAccount(id);
    if (!(key in store.credentials)) return false;

    const credentials = { ...store.credentials };
    delete credentials[key];
    await this.saveStore({
      ...store,
      credentials,
      metadata: { ...store.metadata, updatedAt: Date.now() },
    });
    return true;
  }

  async list(filter?: Partial<CredentialId>): Promise<CredentialId[]> {
    const store = await this.loadStore();
    if (!store) return [];

    const ids = Object.keys(store.credentials)
      .map(accountToCredentialId)
      .filter((id): id is CredentialId => id !== null);

    if (!filter) return ids;

    return ids.filter((id) => {
      if (filter.type && id.type !== filter.type) return false;
      if (filter.workspaceId && id.workspaceId !== filter.workspaceId) return false;
      if (filter.name && id.name !== filter.name) return false;
      return true;
    });
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private async loadStore(): Promise<CredentialStore | null> {
    // Return cached store if available
    if (this.cachedStore) return this.cachedStore;

    if (!existsSync(this.credentialsFile)) return null;

    // Read failures must not turn an existing store into an empty writable store.
    const fileData = readFileSync(this.credentialsFile);

    // Validate minimum size
    if (fileData.length < HEADER_SIZE + IV_SIZE + AUTH_TAG_SIZE) {
      // Preserve malformed data for recovery before starting a new store.
      this.handleCorruptedFile();
      return null;
    }

    // Validate magic bytes
    if (!fileData.subarray(0, MAGIC_SIZE).equals(MAGIC_BYTES)) {
      this.handleCorruptedFile();
      return null;
    }

    // Parse header
    // const flags = fileData.readUInt32LE(MAGIC_SIZE); // Reserved for future use
    const salt = fileData.subarray(MAGIC_SIZE + FLAGS_SIZE, MAGIC_SIZE + FLAGS_SIZE + SALT_SIZE);
    this.salt = salt;

    // Extract encrypted data
    const encryptedData = fileData.subarray(HEADER_SIZE);

    const machineId = this.getMachineId();
    const fallbackId = `${userInfo().username}:${homedir()}`;
    let store = machineId
      ? this.tryDecrypt(encryptedData, this.getEncryptionKey(salt, machineId))
      : null;

    if (store) {
      this.cachedStore = store;
      return store;
    }

    // The v2 fallback is distinct from the hostname-based v1 legacy key.
    store = this.tryDecrypt(encryptedData, this.getEncryptionKey(salt, fallbackId))
      || this.tryDecrypt(encryptedData, this.getLegacyEncryptionKey(salt));
    if (store) {
      if (machineId) await this.saveStore(store);
      this.cachedStore = store;
      return store;
    }

    if (!machineId) {
      throw new Error('Machine identity unavailable; existing credentials preserved. Retry when available.');
    }

    // Authentication failure may mean a changed identity, so retain the original bytes.
    this.handleCorruptedFile();
    return null;
  }

  /**
   * Attempt to decrypt data with given key.
   * Returns parsed store on success, null on failure.
   */
  private tryDecrypt(encryptedData: Buffer, key: Buffer): CredentialStore | null {
    try {
      const iv = encryptedData.subarray(0, IV_SIZE);
      const authTag = encryptedData.subarray(IV_SIZE, IV_SIZE + AUTH_TAG_SIZE);
      const ciphertext = encryptedData.subarray(IV_SIZE + AUTH_TAG_SIZE);

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8'));
    } catch {
      return null;
    }
  }

  private async saveStore(store: CredentialStore): Promise<void> {
    const machineId = this.getMachineId();
    if (!machineId && existsSync(this.credentialsFile)) {
      throw new Error('Machine identity unavailable; refusing to overwrite existing credentials.');
    }
    const credentialsDir = dirname(this.credentialsFile);
    // Ensure directory exists
    if (!existsSync(credentialsDir)) {
      mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });
    }

    // Use existing salt or generate new one
    const salt = this.salt || randomBytes(SALT_SIZE);
    this.salt = salt;

    // Get encryption key
    const key = this.getEncryptionKey(salt, machineId || `${userInfo().username}:${homedir()}`);

    // Serialize payload
    const plaintext = Buffer.from(JSON.stringify(store), 'utf8');

    // Generate new IV for each write (critical for GCM security)
    const iv = randomBytes(IV_SIZE);

    // Encrypt
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Build header
    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC_BYTES.copy(header, 0);
    header.writeUInt32LE(0, MAGIC_SIZE); // Flags (reserved)
    salt.copy(header, MAGIC_SIZE + FLAGS_SIZE);

    // Combine all parts
    const fileData = Buffer.concat([header, iv, authTag, ciphertext]);

    // Write with restrictive permissions (owner read/write only)
    atomicWriteFileSync(this.credentialsFile, fileData, { mode: 0o600 });
    this.cachedStore = store;
  }

  private getMachineId(): string | null {
    this.stableMachineId ||= this.readMachineId();
    if (!this.stableMachineId) {
      console.warn('[SecureStorage] Machine identity unavailable; existing credentials will not be overwritten.');
    }
    return this.stableMachineId;
  }

  private getEncryptionKey(salt: Buffer, machineId: string): Buffer {
    // PBKDF2 is ~100k rounds on the main process; reuse the key for the same salt + identity.
    const cacheKey = `${salt.toString('hex')}:${machineId}`;
    if (this.encryptionKey?.cacheKey === cacheKey) return this.encryptionKey.key;

    const stableMachineId = createHash('sha256')
      .update(machineId)
      .update('craft-agent-v2')
      .digest();

    const key = pbkdf2Sync(stableMachineId, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
    this.encryptionKey = { cacheKey, key };
    return key;
  }

  /**
   * Legacy key derivation for migration from v1 (included hostname).
   * Used to decrypt credentials from older versions before re-encrypting with stable key.
   */
  private getLegacyEncryptionKey(salt: Buffer): Buffer {
    const legacyMachineId = createHash('sha256')
      .update(hostname())
      .update(userInfo().username)
      .update(homedir())
      .update('craft-agent-v1')
      .digest();

    return pbkdf2Sync(legacyMachineId, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
  }

  private handleCorruptedFile(): void {
    const backup = `${this.credentialsFile}.corrupt-${Date.now()}-${randomUUID()}`;
    // Let rename failure propagate: a subsequent write must never overwrite the only copy.
    renameSync(this.credentialsFile, backup);
    console.warn('[SecureStorage] Unreadable credentials preserved in a .corrupt- backup.');
    this.clearCache();

    try {
      const directory = dirname(this.credentialsFile);
      const prefix = `${basename(this.credentialsFile)}.corrupt-`;
      const backups = readdirSync(directory)
        .filter(name => name.startsWith(prefix) && name !== basename(backup))
        .sort().reverse();
      for (const name of backups.slice(2)) unlinkSync(join(directory, name));
    } catch {
      console.warn('[SecureStorage] Could not prune old credential backups.');
    }
  }

  /** Clear cached data (for testing or forced refresh) */
  clearCache(): void {
    this.cachedStore = null;
    this.stableMachineId = null;
    this.encryptionKey = null;
    this.salt = null;
  }
}
