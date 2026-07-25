// input: Environment examples, operator docs, and release workflow
// output: Regression coverage for env-var lifecycle boundaries
// pos: Prevents release, broker, local-dev, and runtime env surfaces from drifting together

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = join(import.meta.dir, '..', '..');

function readRepoFile(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8');
}

describe('environment contract', () => {
  test('documents environment variables by lifecycle instead of one flat env surface', () => {
    const docs = readRepoFile('docs/environment.md');

    expect(docs).toContain('## Local Development');
    expect(docs).toContain('## Packaged Desktop Build');
    expect(docs).toContain('## Auth Broker / Web UI Server');
    expect(docs).toContain('## Electron Runtime Internals');
    expect(docs).toContain('## Installed-Client Recovery');
  });

  test('documents local dotenv file precedence separately for dev and build modes', () => {
    const docs = readRepoFile('docs/environment.md');
    const envExample = readRepoFile('.env.example');
    const gitignore = readRepoFile('.gitignore');

    expect(docs).toContain('explicit shell/CI env > .env.local > .env.dev > .env');
    expect(docs).toContain('explicit shell/CI env > .env.local > .env');
    expect(envExample).toContain('put personal');
    expect(envExample).toContain('overrides in .env.local');
    expect(envExample).toContain('put dev-runtime defaults in .env.dev');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.env.local');
    expect(gitignore).toContain('.env.dev');
  });

  test('keeps the first-party auth broker as the advertised desktop default', () => {
    const advertisedConfig = [
      readRepoFile('.env.example'),
      readRepoFile('docs/environment.md'),
      readRepoFile('docs/feishu-desktop-auth.md'),
      readRepoFile('apps/auth-broker-worker/wrangler.toml'),
    ].join('\n');

    expect(advertisedConfig).toContain('https://storyflow-auth.zjding.com');
    expect(advertisedConfig).not.toContain('storyflow-auth-broker.d1095245867.workers.dev');
  });

  test('keeps the first-party feedback worker as the advertised desktop default', () => {
    const advertisedConfig = [
      readRepoFile('.env.example'),
      readRepoFile('docs/environment.md'),
      readRepoFile('docs/feedback-issue-ingestion.md'),
      readRepoFile('apps/feedback-worker/README.md'),
      readRepoFile('apps/feedback-worker/wrangler.toml'),
      readRepoFile('.github/workflows/deploy-feedback-worker.yml'),
    ].join('\n');

    expect(advertisedConfig).toContain('https://storyflow-feedback.zjding.com/api/feedback');
    expect(advertisedConfig).toContain('storyflow-feedback.zjding.com');
    expect(advertisedConfig).not.toContain('storyflow-feedback.d1095245867.workers.dev');
  });

  test('keeps Skills Market discovery disabled until a deployed origin is configured', () => {
    const workflow = readRepoFile('.github/workflows/release.yml');
    const docs = readRepoFile('docs/environment.md');
    const envExample = readRepoFile('.env.example');

    expect(
      workflow.match(/VITE_STORYFLOW_SKILLS_MARKET_ENABLED: "false"/g),
    ).toHaveLength(2);
    expect(envExample).toContain('VITE_STORYFLOW_SKILLS_MARKET_ENABLED=false');
    expect(docs).toContain('Keep `VITE_STORYFLOW_SKILLS_MARKET_ENABLED=false`');
  });

  test('keeps feedback Worker deployment on an explicit manual workflow', () => {
    const workflow = readRepoFile('.github/workflows/deploy-feedback-worker.yml');

    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(workflow).toContain('CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}');
    expect(workflow).toContain('FEEDBACK_GITHUB_TOKEN');
    expect(workflow).toContain('bunx wrangler secret list --format=json');
    expect(workflow).toContain('working-directory: apps/feedback-worker');
    expect(workflow).toContain('bunx wrangler deploy');
    expect(workflow).not.toContain('push:');
  });

  test('keeps desktop feedback submissions on the Worker boundary instead of local GitHub fallbacks', () => {
    const mainFeedbackSource = readRepoFile('apps/electron/src/main/feedback.ts');
    const feedbackDocs = readRepoFile('docs/feedback-issue-ingestion.md');

    expect(mainFeedbackSource).not.toContain('STORYFLOW_FEEDBACK_GITHUB_TOKEN');
    expect(mainFeedbackSource).not.toContain('GITHUB_TOKEN');
    expect(mainFeedbackSource).not.toContain('gh auth token');
    expect(mainFeedbackSource).not.toContain('api.github.com/repos');
    expect(mainFeedbackSource).not.toContain('buildFeedbackIssueBody');
    expect(feedbackDocs).not.toContain('The desktop app keeps `STORYFLOW_FEEDBACK_GITHUB_TOKEN`');
    expect(feedbackDocs).not.toContain('gh auth token');
  });

  test('does not advertise deprecated Feishu-specific broker env in local examples', () => {
    const envExample = readRepoFile('.env.example');

    expect(envExample).toContain('CRAFT_CLIENT_AUTH_BROKER_URL=');
    expect(envExample).not.toContain('CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL=');
  });

  test('keeps model credentials out of packaged release inputs', () => {
    const workflow = readRepoFile('.github/workflows/release.yml');
    const docs = readRepoFile('docs/environment.md');

    expect(workflow).toContain('CRAFT_CLIENT_AUTH_BROKER_URL: ${{ vars.CRAFT_CLIENT_AUTH_BROKER_URL }}');
    expect(workflow).toContain('CRAFT_CLIENT_FEISHU_APP_ID: ${{ vars.CRAFT_CLIENT_FEISHU_APP_ID }}');
    expect(workflow).toContain('CRAFT_CLIENT_NEON_AUTH_BASE_URL: ${{ vars.CRAFT_CLIENT_NEON_AUTH_BASE_URL }}');
    expect(workflow).toContain('CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED: ${{ vars.CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED }}');
    expect(workflow).not.toContain('CRAFT_CLIENT_GATEWAY_TOKEN');
    expect(docs).toMatch(/GitHub repository vars:[\s\S]*CRAFT_CLIENT_AUTH_BROKER_URL/);
    expect(docs).toMatch(/## Model Gateway Worker[\s\S]*NEWAPI_API_KEY/);
    expect(docs).toContain('None of these values\nbelong in Electron build environment variables or GitHub release secrets.');
  });

  test('marks Feishu app secrets as server-only broker configuration', () => {
    const envExample = readRepoFile('.env.example');
    const docs = readRepoFile('docs/environment.md');

    expect(envExample).toContain('These values belong on the broker/server. Do not bake them into Electron.');
    expect(docs).toMatch(/Server-only values stay on the broker or Web UI server[\s\S]*CRAFT_WEBUI_FEISHU_APP_SECRET/);
    expect(docs).toMatch(/The Feishu app secret and user allow policy belong on the\s+broker side only\./);
  });

  test('keeps installed-client recovery as a file override instead of another release env', () => {
    const docs = readRepoFile('docs/environment.md');

    expect(docs).toContain('client-auth.json');
    expect(docs).toContain('{ "authBrokerUrl": "https://storyflow-auth.zjding.com" }');
    expect(docs).toContain('The override wins over packaged defaults');
  });
});
