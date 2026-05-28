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

  test('does not advertise deprecated Feishu-specific broker env in local examples', () => {
    const envExample = readRepoFile('.env.example');

    expect(envExample).toContain('CRAFT_CLIENT_AUTH_BROKER_URL=');
    expect(envExample).not.toContain('CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL=');
  });

  test('separates public release vars from release secrets', () => {
    const workflow = readRepoFile('.github/workflows/release.yml');
    const docs = readRepoFile('docs/environment.md');

    expect(workflow).toContain('CRAFT_CLIENT_AUTH_BROKER_URL: ${{ vars.CRAFT_CLIENT_AUTH_BROKER_URL }}');
    expect(workflow).toContain('CRAFT_CLIENT_FEISHU_APP_ID: ${{ vars.CRAFT_CLIENT_FEISHU_APP_ID }}');
    expect(workflow).toContain('CRAFT_CLIENT_NEON_AUTH_BASE_URL: ${{ vars.CRAFT_CLIENT_NEON_AUTH_BASE_URL }}');
    expect(workflow).toContain('CRAFT_CLIENT_GATEWAY_TOKEN: ${{ secrets.CRAFT_CLIENT_GATEWAY_TOKEN }}');
    expect(docs).toMatch(/GitHub repository vars:[\s\S]*CRAFT_CLIENT_AUTH_BROKER_URL/);
    expect(docs).toMatch(/GitHub repository secrets:[\s\S]*CRAFT_CLIENT_GATEWAY_TOKEN/);
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
