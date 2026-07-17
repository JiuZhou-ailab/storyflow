// input: API authentication scheme and token
// output: Deterministic Authorization header value
// pos: Runtime-neutral API credential formatting shared by sources and adapters

export function buildAuthorizationHeader(authScheme: string | undefined, token: string): string {
  const scheme = authScheme ?? 'Bearer';
  return scheme ? `${scheme} ${token}` : token;
}
