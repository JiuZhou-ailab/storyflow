// input: Pi provider response status and session-scoped subprocess environment.
// output: Cross-process API error diagnostics and bounded debug logging.
// pos: Shared diagnostic bridge between Pi provider hooks and the main process.

/**
 * Shared infrastructure for status-only Pi provider diagnostics.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Packaged apps run from inside an app.asar archive */
export const IS_PACKAGED = process.argv.some(arg => arg.includes('app.asar'));

/** Enable provider logging in dev mode (not packaged), disable in production */
export const PROVIDER_LOGGING_ENABLED = !IS_PACKAGED;

export const DEBUG = PROVIDER_LOGGING_ENABLED &&
  (process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1');

/** Session directory injected into the Pi subprocess. */
const SESSION_DIR = process.env.CRAFT_SESSION_DIR || null;

// ============================================================================
// LOGGING
// ============================================================================

export const LOG_DIR = join(homedir(), '.craft-agent', 'logs');
export const LOG_FILE = join(LOG_DIR, 'provider-diagnostics.log');

// Ensure log directory exists at module load
try {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // Ignore - logging will silently fail if dir can't be created
}

// Rotate log file if older than 1 day
const MAX_LOG_AGE_MS = 24 * 60 * 60 * 1000;
try {
  if (existsSync(LOG_FILE)) {
    const stat = statSync(LOG_FILE);
    if (Date.now() - stat.mtimeMs > MAX_LOG_AGE_MS) {
      const prevLog = LOG_FILE + '.prev';
      renameSync(LOG_FILE, prevLog);
    }
  }
} catch {
  // Ignore — rotation is best-effort
}

export function debugLog(...args: unknown[]) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  const message = `${timestamp} [provider] ${args.map((a) => {
    if (typeof a === 'object') {
      try {
        return JSON.stringify(a);
      } catch (e) {
        const keys = a && typeof a === 'object' ? Object.keys(a as object).join(', ') : 'unknown';
        return `[CYCLIC STRUCTURE, keys: ${keys}] (error: ${e})`;
      }
    }
    return String(a);
  }).join(' ')}`;
  try {
    appendFileSync(LOG_FILE, message + '\n');
  } catch {
    // Silently fail if can't write to log file
  }
}

// ============================================================================
// LAST API ERROR
// ============================================================================

/**
 * Store the last API error for the error handler to access.
 * Uses file-based storage to reliably share across process boundaries.
 */
export interface LastApiError {
  status: number;
  statusText: string;
  message: string;
  timestamp: number;
}

const MAX_ERROR_AGE_MS = 5 * 60 * 1000; // 5 minutes

function getErrorFilePath(sessionDir?: string): string {
  // Prefer session-scoped file to avoid cross-session error consumption.
  if (sessionDir || SESSION_DIR) return join(sessionDir || SESSION_DIR!, 'api-error.json');
  // Fallback for legacy/non-session contexts.
  return join(homedir(), '.craft-agent', 'api-error.json');
}

function getStoredError(sessionDir?: string): LastApiError | null {
  const errorFile = getErrorFilePath(sessionDir);
  try {
    if (!existsSync(errorFile)) return null;
    const content = readFileSync(errorFile, 'utf-8');
    const error = JSON.parse(content) as LastApiError;
    try {
      unlinkSync(errorFile);
      debugLog(`[getStoredError] Popped error file`);
    } catch {
      // Ignore delete errors
    }
    return error;
  } catch {
    return null;
  }
}

export function setStoredError(error: LastApiError | null, sessionDir?: string): void {
  const errorFile = getErrorFilePath(sessionDir);
  try {
    if (error) {
      writeFileSync(errorFile, JSON.stringify(error));
      debugLog(`[setStoredError] Wrote error to file: ${error.status} ${error.message}`);
    } else {
      try {
        unlinkSync(errorFile);
      } catch {
        // File might not exist
      }
    }
  } catch (e) {
    debugLog(`[setStoredError] Failed to write: ${e}`);
  }
}

export function getLastApiError(sessionDir?: string): LastApiError | null {
  const error = getStoredError(sessionDir);
  if (error) {
    const age = Date.now() - error.timestamp;
    if (age < MAX_ERROR_AGE_MS) {
      debugLog(`[getLastApiError] Found error (age ${age}ms): ${error.status}`);
      return error;
    }
    debugLog(`[getLastApiError] Error too old (${age}ms > ${MAX_ERROR_AGE_MS}ms)`);
  }
  return null;
}

export function clearLastApiError(sessionDir?: string): void {
  setStoredError(null, sessionDir);
}
