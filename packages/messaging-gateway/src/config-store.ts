/**
 * input: Workspace storage directory, optional legacy directory, and config updates
 * output: MessagingConfig snapshots with write failures reported to callers
 * pos: Workspace messaging config.json persistence and legacy path migration
 */

import {
  readFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@craft-agent/shared/utils'
import { DEFAULT_MESSAGING_CONFIG, type MessagingConfig, type MessagingLogger } from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

export class ConfigStore {
  private readonly dirPath: string
  private readonly filePath: string
  private readonly log: MessagingLogger
  private config: MessagingConfig

  constructor(storageDir: string, legacyDir?: string, logger: MessagingLogger = NOOP_LOGGER) {
    this.dirPath = storageDir
    this.filePath = join(storageDir, 'config.json')
    this.log = logger
    this.migrateLegacy(legacyDir)
    this.config = this.load()
  }

  get(): MessagingConfig {
    return { ...this.config, platforms: { ...this.config.platforms } }
  }

  update(partial: Partial<MessagingConfig>): MessagingConfig {
    const next: MessagingConfig = {
      enabled: partial.enabled ?? this.config.enabled,
      platforms: {
        ...this.config.platforms,
        ...(partial.platforms ?? {}),
      },
    }
    this.save(next)
    this.config = next
    return this.get()
  }

  private migrateLegacy(legacyDir?: string): void {
    if (!legacyDir) return
    const legacyFile = join(legacyDir, 'config.json')
    if (existsSync(this.filePath)) return
    if (!existsSync(legacyFile)) return
    try {
      if (!existsSync(this.dirPath)) mkdirSync(this.dirPath, { recursive: true })
      copyFileSync(legacyFile, this.filePath)
      this.log.info('messaging config migrated from legacy location', {
        event: 'config_migrated',
        legacyFile,
        filePath: this.filePath,
      })
    } catch (err) {
      this.log.error('messaging config migration failed', {
        event: 'config_migration_failed',
        legacyFile,
        filePath: this.filePath,
        error: err,
      })
    }
  }

  private load(): MessagingConfig {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<MessagingConfig>
        return {
          enabled: parsed.enabled ?? DEFAULT_MESSAGING_CONFIG.enabled,
          platforms: parsed.platforms ?? { ...DEFAULT_MESSAGING_CONFIG.platforms },
        }
      }
    } catch (err) {
      this.log.error('failed to load messaging config', {
        event: 'config_load_failed',
        filePath: this.filePath,
        error: err,
      })
    }
    return { ...DEFAULT_MESSAGING_CONFIG, platforms: {} }
  }

  private save(config: MessagingConfig): void {
    try {
      if (!existsSync(this.dirPath)) mkdirSync(this.dirPath, { recursive: true })
      atomicWriteFileSync(this.filePath, JSON.stringify(config, null, 2))
    } catch (err) {
      this.log.error('failed to save messaging config', {
        event: 'config_save_failed',
        filePath: this.filePath,
        error: err,
      })
      throw new Error('Failed to save messaging config.', { cause: err })
    }
  }
}
