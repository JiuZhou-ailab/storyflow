/**
 * Comparable signatures of a file's extended access controls.
 *
 * Replacing a file through a sibling temp file and rename publishes the temp
 * file's own access controls. Mode and owner can be copied with fs calls, but
 * macOS ACLs, Linux POSIX ACLs and security labels (SELinux, Smack) and Windows
 * DACLs cannot be read or written from Node (Electron main) or Bun without
 * native code. This module renders them with the platform's stock tool so a
 * caller can confirm that a temp file's extended access equals the original's
 * before publishing it.
 *
 * `null` means the access could not be confirmed. Callers must treat it as a
 * mismatch and keep the original file.
 */

import { execFile, execFileSync } from 'node:child_process';
import { basename, dirname, win32 } from 'node:path';

interface ProbeCommand {
  file: string;
  args: string[];
  cwd?: string;
}

const PROBE_TIMEOUT_MS = 5_000;

function probeCommand(filePath: string, platform: NodeJS.Platform): ProbeCommand | null {
  switch (platform) {
    case 'darwin':
      // Absolute path: a GNU ls earlier in PATH has no -e.
      return { file: '/bin/ls', args: ['-lde', '--', filePath] };
    case 'linux':
      // --quoting-style exists only in GNU and uutils ls. BusyBox ls never
      // prints the ACL marker, so it must fail here instead of reporting none.
      // -Z adds the security label as the fifth column; -n keeps owner and
      // group numeric so a name with spaces cannot shift it.
      return { file: 'ls', args: ['-ldnZ', '--quoting-style=literal', '--', filePath] };
    case 'win32':
      // Run beside the file so icacls echoes a known name before the first ACE.
      // Absolute path: Windows command lookup tries the cwd (a workspace) first.
      return {
        file: win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'),
        args: [basename(filePath)],
        cwd: dirname(filePath),
      };
    default:
      return null;
  }
}

/**
 * Parse probe output into a signature. Two files with equal signatures have
 * the same extended access controls; mode bits and owner are not included.
 */
export function parseAccessSignature(
  platform: NodeJS.Platform,
  fileName: string,
  stdout: string,
): string | null {
  const lines = stdout.split(/\r?\n/);
  switch (platform) {
    case 'darwin':
      // The long listing comes first; each ACE follows as " 0: user:nobody deny read".
      if (!lines[0]?.trim()) return null;
      return lines.slice(1).map(line => line.trim()).filter(Boolean).join('\n');
    case 'linux': {
      // "-rw-r--r--. 1 1000 1000 unconfined_u:object_r:user_home_t:s0 78 Nov 28 10:00 /w/h"
      const [mode = '', , , , label] = lines[0]?.trim().split(/\s+/) ?? [];
      if (!/^[-dlcbps][-rwxsStT]{9}[.+]?$/.test(mode) || !label) return null;
      // "+" marks an ACL (GNU and uutils print it in preference to "."). Its
      // entries are not shown, so equality with another file cannot be confirmed.
      if (mode.endsWith('+')) return null;
      // "." marks a security label; "?" means ls could not show one.
      if (label === '?') return mode.endsWith('.') ? null : '';
      return label;
    }
    case 'win32': {
      // "<name> <ACE>", then one indented ACE per line, a blank line and a
      // localized summary.
      const end = lines.findIndex(line => line.trim() === '');
      const listing = end === -1 ? lines : lines.slice(0, end);
      const first = listing[0];
      if (!first?.startsWith(`${fileName} `)) return null;
      const aces = [first.slice(fileName.length + 1), ...listing.slice(1)].map(line => line.trim());
      if (aces.some(ace => !ace.includes(':('))) return null;
      return aces.join('\n');
    }
    default:
      return null;
  }
}

function probeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, LC_ALL: 'C' };
}

export function readAccessSignatureSync(filePath: string): string | null {
  const command = probeCommand(filePath, process.platform);
  if (!command) return null;
  try {
    const stdout = execFileSync(command.file, command.args, {
      cwd: command.cwd,
      encoding: 'utf8',
      env: probeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    return parseAccessSignature(process.platform, basename(filePath), stdout);
  } catch {
    return null;
  }
}

export function readAccessSignature(filePath: string): Promise<string | null> {
  const command = probeCommand(filePath, process.platform);
  if (!command) return Promise.resolve(null);
  return new Promise(resolve => {
    execFile(command.file, command.args, {
      cwd: command.cwd,
      encoding: 'utf8',
      env: probeEnv(),
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout) => {
      resolve(error ? null : parseAccessSignature(process.platform, basename(filePath), stdout));
    });
  });
}
