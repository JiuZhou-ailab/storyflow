// input: Runtime environment, debug flag, log level, scope, message, and structured arguments
// output: Debug-gated logs routed once through Electron, renderer console, or CLI stderr
// pos: Shared low-level diagnostic logger; transports own timestamps and serialization

// Check CRAFT_DEBUG env var at module load (for SDK subprocess)
// Guard against browser/renderer contexts where process is undefined
let debugEnabled = typeof process !== 'undefined' && process.env?.CRAFT_DEBUG === '1';

function isCliJsonOnlyMode(): boolean {
  return typeof process !== 'undefined' && process.env?.CRAFT_CLI_JSON_ONLY === '1';
}

/**
 * Runtime environment detection
 */
type Environment = 'electron-main' | 'electron-renderer' | 'cli';

function detectEnvironment(): Environment {
  // No process object means we're in a browser/renderer context
  if (typeof process === 'undefined') {
    return 'electron-renderer';
  }
  // Electron main process
  if ((process as any).type === 'browser') {
    return 'electron-main';
  }
  // Electron renderer process (with nodeIntegration)
  if ((process as any).type === 'renderer') {
    return 'electron-renderer';
  }
  // Default: CLI/scripts
  return 'cli';
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogTarget {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

interface ElectronLogTarget extends LogTarget {
  scope?: (name: string) => LogTarget;
}

let electronLog: ElectronLogTarget | null = null;
let electronLogChecked = false;

function getElectronLog(): ElectronLogTarget | null {
  if (electronLogChecked) {
    return electronLog;
  }
  electronLogChecked = true;
  try {
    // Optional dependency - only available in Electron main process.
    const loaded = require('electron-log/main');
    electronLog = loaded?.default ?? loaded ?? null;
  } catch {
    electronLog = null;
  }
  return electronLog;
}

/**
 * Enable debug logging. Call this when --debug flag is passed.
 */
export function enableDebug(): void {
  debugEnabled = true;
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnabled(): boolean {
  if (isCliJsonOnlyMode()) return false;
  return debugEnabled;
}

/**
 * Safely stringify an object, handling circular references.
 */
function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    // Handle circular references by using a replacer that tracks seen objects
    const seen = new WeakSet();
    return JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    });
  }
}

/**
 * Format a standalone CLI log line. Electron and browser consoles already own
 * timestamps and argument serialization, so they receive the raw arguments.
 */
function formatCliMessage(level: LogLevel, scope: string | undefined, message: string, args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const levelStr = level.toUpperCase().padEnd(5);
  const scopeStr = scope ? `[${scope}] ` : '';
  const argsStr = args.length > 0
    ? ' ' + args.map(a => typeof a === 'object' ? safeStringify(a) : String(a)).join(' ')
    : '';
  return `${timestamp} ${levelStr} ${scopeStr}${message}${argsStr}\n`;
}

/**
 * Output log based on environment.
 *
 * Electron main uses electron-log; CLI uses stderr; renderer uses DevTools.
 */
function output(level: LogLevel, scope: string | undefined, message: string, args: unknown[]): void {
  const env = detectEnvironment();

  if (env === 'electron-main') {
    const log = getElectronLog();
    const target = scope ? log?.scope?.(scope) ?? log : log;
    target?.[level]?.(message, ...args);
    return;
  }

  if (env === 'electron-renderer') {
    const target = console[level] ?? console.log;
    target(scope ? `[${scope}] ${message}` : message, ...args);
  } else if (typeof process !== 'undefined' && process.stderr) {
    process.stderr.write(formatCliMessage(level, scope, message, args));
  } else {
    console[level]?.(scope ? `[${scope}] ${message}` : message, ...args);
  }
}

/**
 * Debug logging utility that auto-routes based on environment.
 * Only logs when debug mode is enabled via --debug flag.
 *
 * Output routing:
 * - Electron main: electron-log transports
 * - Electron renderer: console (DevTools)
 * - CLI/scripts: console only
 *
 * @example
 * debug('Processing request')
 * debug('User data', { id: 123 })
 */
export function debug(message: string, ...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  output('debug', undefined, message, args);
}

/**
 * Create a scoped logger for a specific module.
 * Scope appears in brackets: [scope] message
 *
 * @example
 * const log = createLogger('agent');
 * log.debug('Starting session');
 * log.info('Connected to MCP');
 * log.error('Failed to connect', error);
 */
export function createLogger(scope: string) {
  const logWithLevel = (level: LogLevel, message: string, args: unknown[]) => {
    if (!isDebugEnabled()) return;
    output(level, scope, message, args);
  };

  return {
    debug: (message: string, ...args: unknown[]) => logWithLevel('debug', message, args),
    info: (message: string, ...args: unknown[]) => logWithLevel('info', message, args),
    warn: (message: string, ...args: unknown[]) => logWithLevel('warn', message, args),
    error: (message: string, ...args: unknown[]) => logWithLevel('error', message, args),
  };
}
