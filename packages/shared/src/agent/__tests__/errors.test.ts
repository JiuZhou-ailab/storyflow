// input: Representative provider, protocol, authentication, and stream failures
// output: Regression coverage for shared typed-error classification
// pos: Protects actionable UI error semantics from raw provider status codes

import { describe, expect, it } from 'bun:test'
import { parseError } from '../errors.ts'

describe('parseError', () => {
  it('maps interceptor proxy marker message to proxy_error', () => {
    const message = 'Received an unexpected HTML error page (HTTP 400) instead of a JSON API response. This may be caused by your network proxy (http://example.com:8080). Check your proxy settings in Settings > Network.'
    const parsed = parseError(new Error(message))

    expect(parsed.code).toBe('proxy_error')
    expect(parsed.message).toBe(message)
  })

  it('does not misclassify an upstream ALB HTML error as a local proxy failure', () => {
    const rawHtml = `<html>
<head><title>400 Bad Request</title></head>
<body>
<center><h1>400 Bad Request</h1></center>
<hr><center>alb</center>
</body>
</html>`

    const parsed = parseError(new Error(rawHtml))

    expect(parsed.code).toBe('service_error')
    expect(parsed.message.toLowerCase()).not.toContain('proxy settings')
    expect(parsed.message.toLowerCase()).not.toContain('<html')
    expect(parsed.originalError).toBe(rawHtml)
  })

  it('classifies Cloudflare-specific upstream failures as service errors', () => {
    expect(parseError(new Error('520 error code: 520')).code).toBe('service_error')
    expect(parseError(new Error('524 error code: 524')).code).toBe('service_error')
  })

  it('does not remap regular 401 auth errors as proxy_error', () => {
    expect(parseError(new Error('401 Unauthorized')).code).toBe('invalid_api_key')
    expect(parseError(new Error('API key is required')).code).toBe('invalid_api_key')
    expect(parseError(new Error('Authentication required')).code).toBe('invalid_api_key')
  })

  it('classifies model access token rejection as auth, not a missing model', () => {
    expect(parseError(new Error('401 "Invalid model access token"')).code).toBe('invalid_api_key')
    expect(parseError(new Error('Invalid model access token')).code).toBe('invalid_api_key')
    expect(parseError(new Error('model_access_token_invalid')).code).toBe('invalid_api_key')
    expect(parseError(new Error('Provided authentication token is expired.')).code).toBe('expired_oauth_token')
    expect(parseError(new Error('Model not found.')).code).toBe('invalid_model')
  })

  it('keeps gateway upstream credential failures out of the client auth retry path', () => {
    const parsed = parseError(new Error(
      '502 {"error":"Model provider authentication failed","code":"upstream_auth_failed"}',
    ))

    expect(parsed.code).toBe('service_error')
  })

  it('maps unsupported upstream protocol conversion to a non-retryable request error', () => {
    const parsed = parseError(new Error(
      'OpenAI API error (500): {"message":"not implemented","code":"convert_request_failed"}',
    ))

    expect(parsed.code).toBe('invalid_request')
    expect(parsed.title).toBe('Model Protocol Unsupported')
    expect(parsed.canRetry).toBe(false)
    expect(parsed.actions.some(action => action.action === 'retry')).toBe(false)
  })

  it('maps provider overloads to a retryable service error', () => {
    const parsed = parseError(new Error('Provider is overloaded'))

    expect(parsed.code).toBe('service_error')
    expect(parsed.canRetry).toBe(true)
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
