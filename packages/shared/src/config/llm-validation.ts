// input: Raw Pi/provider connection errors
// output: Stable user-facing connection error messages
// pos: Presentation-only parser; Pi owns connection execution and protocol validation

/** Parse provider errors into stable product-facing messages. */
export function parseValidationError(msg: string): string {
  const lowerMsg = msg.toLowerCase();

  if (lowerMsg.includes('econnrefused') || lowerMsg.includes('enotfound') || lowerMsg.includes('fetch failed')) {
    return 'Cannot connect to API server. Check the URL and ensure the server is running.';
  }
  if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('authentication')) {
    return 'Authentication failed. Check your API key or OAuth token.';
  }
  if (lowerMsg.includes('403') || lowerMsg.includes('forbidden') || lowerMsg.includes('permission')) {
    return 'Access denied. Check your API key permissions.';
  }
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit') || lowerMsg.includes('quota')) {
    return 'Rate limited or quota exceeded. Try again later.';
  }
  if (lowerMsg.includes('402') || lowerMsg.includes('credit') || lowerMsg.includes('billing') || lowerMsg.includes('insufficient')) {
    return 'Billing issue. Check your account credits or payment method.';
  }
  if (lowerMsg.includes('model not found') || lowerMsg.includes('invalid model')) {
    return 'Model not found. Check the connection configuration.';
  }
  if (lowerMsg.includes('404') && !lowerMsg.includes('model')) {
    return 'Endpoint not found. Ensure the server supports the configured API protocol.';
  }
  if (lowerMsg.includes('500') || lowerMsg.includes('502') || lowerMsg.includes('503') || lowerMsg.includes('service unavailable')) {
    return 'API temporarily unavailable. Try again in a few seconds.';
  }

  return msg.slice(0, 200);
}
