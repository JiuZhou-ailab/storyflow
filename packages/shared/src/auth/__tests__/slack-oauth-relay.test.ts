import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const slackOAuthUrl = pathToFileURL(join(import.meta.dir, '..', 'slack-oauth.ts')).href

/** Slack credentials are read at module load, so each case runs in its own process. */
function prepare(env: Record<string, string>, options: Record<string, unknown>): { redirectUri?: string; error?: string } {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `
      import { prepareSlackOAuth } from '${slackOAuthUrl}';
      try {
        const { redirectUri } = prepareSlackOAuth(${JSON.stringify(options)});
        console.log('SLACK_RESULT=' + JSON.stringify({ redirectUri }));
      } catch (error) {
        console.log('SLACK_RESULT=' + JSON.stringify({ error: error.message }));
      }
    `,
  ], {
    env: {
      ...process.env,
      SLACK_OAUTH_CLIENT_ID: 'client-id',
      SLACK_OAUTH_CLIENT_SECRET: 'client-secret',
      SLACK_OAUTH_RELAY_URL: '',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const match = run.stdout.toString().match(/SLACK_RESULT=(\{.*\})/)
  if (!match) throw new Error(`Missing Slack result:\n${run.stdout}\n${run.stderr}`)
  return JSON.parse(match[1]!)
}

describe('Slack OAuth relay', () => {
  it('refuses the local callback flow when no relay is configured', () => {
    const result = prepare({}, { callbackPort: 6477 })
    expect(result.error).toContain('SLACK_OAUTH_RELAY_URL')
  })

  it('redirects through the configured relay with the local port', () => {
    const result = prepare({ SLACK_OAUTH_RELAY_URL: 'https://relay.example.com/auth/slack/callback' }, { callbackPort: 6477 })
    expect(result.redirectUri).toBe('https://relay.example.com/auth/slack/callback?port=6477')
  })

  it('uses an explicit server callback without a relay', () => {
    const result = prepare({}, { callbackUrl: 'https://webui.example.com/api/oauth/callback' })
    expect(result.redirectUri).toBe('https://webui.example.com/api/oauth/callback')
  })
})
