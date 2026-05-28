// input: Desktop auth build-time environment variables
// output: Pure validation result for packaged Electron client auth broker config
// pos: Shared release guard for Electron main-process build entrypoints

export type DesktopAuthBuildValidationResult =
  | { ok: true }
  | { ok: false, message: string };

type Env = Record<string, string | undefined>;

function readBooleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function readEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isLocalhostHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

export function validateDesktopAuthBuildEnv(env: Env): DesktopAuthBuildValidationResult {
  if (readBooleanEnv(env.CRAFT_DEV_RUNTIME)) return { ok: true };
  if (!readBooleanEnv(env.CRAFT_CLIENT_AUTH_REQUIRED)) return { ok: true };

  const brokerUrl = readEnv(env.CRAFT_CLIENT_AUTH_BROKER_URL)
    ?? readEnv(env.CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL);

  if (!brokerUrl) {
    return {
      ok: false,
      message: 'CRAFT_CLIENT_AUTH_BROKER_URL is required for packaged desktop client auth.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(brokerUrl);
  } catch {
    return {
      ok: false,
      message: `Invalid CRAFT_CLIENT_AUTH_BROKER_URL: ${brokerUrl}`,
    };
  }

  if (isLocalhostHostname(parsed.hostname)) {
    return {
      ok: false,
      message: 'Refusing to package desktop client auth with a localhost broker. ' +
        'Set CRAFT_CLIENT_AUTH_BROKER_URL to the deployed HTTPS auth broker, or set CRAFT_DEV_RUNTIME=1 for a dev-only build.',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      message: 'CRAFT_CLIENT_AUTH_BROKER_URL must use https for packaged desktop client auth.',
    };
  }

  return { ok: true };
}
