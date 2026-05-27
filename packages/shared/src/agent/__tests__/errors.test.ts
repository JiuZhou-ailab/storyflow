import { describe, expect, it } from 'bun:test'
import { parseError } from '../errors.ts'

describe('parseError proxy interception handling', () => {
  it('maps interceptor proxy marker message to proxy_error', () => {
    const message = 'Received an unexpected HTML error page (HTTP 400) instead of a JSON API response. This may be caused by your network proxy (http://example.com:8080). Check your proxy settings in Settings > Network.'
    const parsed = parseError(new Error(message))

    expect(parsed.code).toBe('proxy_error')
    expect(parsed.message).toBe(message)
  })

  it('maps raw Cloudflare HTML error page to proxy_error with sanitized message', () => {
    const rawHtml = `<html>
<head><title>400 Bad Request</title></head>
<body>
<center><h1>400 Bad Request</h1></center>
<hr><center>cloudflare</center>
</body>
</html>`

    const parsed = parseError(new Error(rawHtml))

    expect(parsed.code).toBe('proxy_error')
    expect(parsed.message).toContain('unexpected HTML error page')
    expect(parsed.message).toContain('HTTP 400')
    expect(parsed.message.toLowerCase()).toContain('proxy settings')
    expect(parsed.message.toLowerCase()).not.toContain('<html')
    expect(parsed.originalError).toBe(rawHtml)
  })

  it('does not remap regular 401 auth errors as proxy_error', () => {
    const parsed = parseError(new Error('401 Unauthorized'))

    expect(parsed.code).toBe('invalid_api_key')
  })

  it('maps missing Anthropic message_stop stream endings to retryable provider_error', () => {
    const parsed = parseError(new Error('Anthropic stream ended before message_stop'))

    expect(parsed.code).toBe('provider_error')
    expect(parsed.canRetry).toBe(true)
    expect(parsed.actions.some(action => action.action === 'retry')).toBe(true)
    expect(parsed.message.toLowerCase()).toContain('stream')
  })

  it('maps provider content filtering to non-retryable content_filtered', () => {
    const parsed = parseError(new Error('Provider finish_reason: content_filtered'))

    expect(parsed.code).toBe('content_filtered')
    expect(parsed.canRetry).toBe(false)
    expect(parsed.message.toLowerCase()).toContain('safety filter')
    expect(parsed.originalError).toBe('Provider finish_reason: content_filtered')
  })
})
