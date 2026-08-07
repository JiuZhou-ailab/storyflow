// input: Storyflow loopback broker capability and expected managed gateway origin
// output: Short-lived Storyflow access tokens for first-party managed Sources
// pos: Trust boundary between desktop login ownership and Source HTTP execution

export const STORYFLOW_MODEL_ACCESS_BROKER_URL_ENV = 'STORYFLOW_MODEL_ACCESS_BROKER_URL';
export const STORYFLOW_MODEL_ACCESS_BROKER_TOKEN_ENV = 'STORYFLOW_MODEL_ACCESS_BROKER_TOKEN';

interface ManagedAccessResponse {
  gatewayBaseUrl?: unknown;
  modelAccessToken?: unknown;
  code?: unknown;
}

export interface StoryflowManagedAccessOptions {
  expectedGatewayBaseUrl: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

function safeHttpsOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Storyflow managed gateway must be an HTTPS origin without credentials');
  }
  return url.origin;
}

function assertLoopbackBrokerUrl(raw: string): void {
  const url = new URL(raw);
  const loopback = url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '[::1]';
  if (url.protocol !== 'http:' || !loopback || url.username || url.password) {
    throw new Error('Storyflow managed access broker must be a credential-free loopback HTTP URL');
  }
}

export async function resolveStoryflowManagedAccess(
  options: StoryflowManagedAccessOptions,
  forceRefresh = false,
): Promise<{ gatewayBaseUrl: string; token: string }> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const brokerUrl = env[STORYFLOW_MODEL_ACCESS_BROKER_URL_ENV];
  const brokerToken = env[STORYFLOW_MODEL_ACCESS_BROKER_TOKEN_ENV];
  if (!brokerUrl && !brokerToken) {
    throw new Error('Storyflow login is required for this managed Source');
  }
  if (!brokerUrl || !brokerToken) {
    throw new Error('Storyflow managed access environment is incomplete; restart Storyflow');
  }
  assertLoopbackBrokerUrl(brokerUrl);

  const response = await fetchImpl(brokerUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${brokerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ forceRefresh }),
  });
  const body = await response.json().catch(() => null) as ManagedAccessResponse | null;
  if (response.status === 401 || body?.code === 'storyflow_login_required') {
    throw new Error('Storyflow login has expired; sign in again and retry');
  }
  if (!response.ok
    || typeof body?.gatewayBaseUrl !== 'string'
    || typeof body.modelAccessToken !== 'string'
    || !body.modelAccessToken.trim()) {
    throw new Error(`Storyflow managed access failed (${response.status})`);
  }

  const gatewayBaseUrl = safeHttpsOrigin(body.gatewayBaseUrl);
  const expectedGatewayBaseUrl = safeHttpsOrigin(options.expectedGatewayBaseUrl);
  if (gatewayBaseUrl !== expectedGatewayBaseUrl) {
    throw new Error('Storyflow managed gateway does not match the Source configuration');
  }
  return { gatewayBaseUrl, token: body.modelAccessToken };
}

export function createStoryflowManagedTokenGetter(
  options: StoryflowManagedAccessOptions,
): () => Promise<string> {
  return async () => (await resolveStoryflowManagedAccess(options)).token;
}
