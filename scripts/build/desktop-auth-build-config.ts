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

function readOptionalBooleanEnv(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function readEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isLocalhostHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function hasNeonLoginMethod(env: Env): boolean {
  return Boolean(readEnv(env.CRAFT_CLIENT_NEON_AUTH_BASE_URL) || readEnv(env.CRAFT_WEBUI_NEON_AUTH_BASE_URL));
}

export function validateDesktopAuthBuildEnv(env: Env): DesktopAuthBuildValidationResult {
  if (readBooleanEnv(env.CRAFT_DEV_RUNTIME)) return { ok: true };

  const explicitAuthRequired = readOptionalBooleanEnv(env.CRAFT_CLIENT_AUTH_REQUIRED);
  if (explicitAuthRequired === false) return { ok: true };

  const hasNeonLogin = hasNeonLoginMethod(env);
  const feishuAppId = readEnv(env.CRAFT_CLIENT_FEISHU_APP_ID);
  const brokerUrl = readEnv(env.CRAFT_CLIENT_AUTH_BROKER_URL)
    ?? readEnv(env.CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL);
  const hasFeishuLogin = Boolean(feishuAppId);

  if (!hasNeonLogin && !hasFeishuLogin && !brokerUrl) {
    return {
      ok: false,
      message: 'Packaged desktop client auth requires CRAFT_CLIENT_FEISHU_APP_ID or CRAFT_CLIENT_NEON_AUTH_BASE_URL.',
    };
  }

  if (brokerUrl && !feishuAppId) {
    return {
      ok: false,
      message: 'CRAFT_CLIENT_FEISHU_APP_ID is required when CRAFT_CLIENT_AUTH_BROKER_URL is set.',
    };
  }

  if (feishuAppId && !brokerUrl) {
    return {
      ok: false,
      message: 'CRAFT_CLIENT_AUTH_BROKER_URL is required for packaged Feishu client auth.',
    };
  }

  if (!brokerUrl) {
    if (!readEnv(env.CRAFT_CLIENT_GATEWAY_TOKEN) && !readEnv(env.CRAFT_BUILTIN_LLM_API_KEY)) {
      return {
        ok: false,
        message: 'CRAFT_CLIENT_GATEWAY_TOKEN is required for the packaged direct Cloudflare model gateway.',
      };
    }
    return { ok: true };
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

  if (!readEnv(env.CRAFT_CLIENT_GATEWAY_TOKEN) && !readEnv(env.CRAFT_BUILTIN_LLM_API_KEY)) {
    return {
      ok: false,
      message: 'CRAFT_CLIENT_GATEWAY_TOKEN is required for the packaged direct Cloudflare model gateway.',
    };
  }

  return { ok: true };
}
