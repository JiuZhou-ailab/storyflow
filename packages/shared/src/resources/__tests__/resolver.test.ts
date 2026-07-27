// input: Temporary absolute roots representing global and project resource scopes
// output: Proof of global Skills/Extensions and project-over-global Sources
// pos: Unit contract for Storyflow's single resource-root resolver

import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { CONFIG_DIR } from '../../config/paths.ts';
import { resolveResourceRoots } from '../resolver.ts';

describe('resolveResourceRoots', () => {
  it('resolves a global-only scope when projectRoot is absent', () => {
    const roots = resolveResourceRoots();

    expect(roots).toEqual({
      skillsPath: resolve(CONFIG_DIR, 'skills'),
      sources: [{
        origin: 'global',
        rootPath: resolve(CONFIG_DIR),
        path: resolve(CONFIG_DIR, 'sources'),
      }],
      extensionsPath: resolve(CONFIG_DIR, 'extensions'),
    });
  });

  it('keeps Skills global while placing project Sources before global Sources', () => {
    const roots = resolveResourceRoots({
      projectRoot: '/tmp/storyflow-project',
      globalRoot: '/tmp/storyflow-global',
    });

    expect(roots.skillsPath).toBe(resolve('/tmp/storyflow-global/skills'));
    expect(roots.sources.map(root => root.origin)).toEqual(['project', 'global']);
    expect(roots.sources.map(root => root.path)).toEqual([
      resolve('/tmp/storyflow-project/.craft-agent/sources'),
      resolve('/tmp/storyflow-global/sources'),
    ]);
  });

  it('never exposes project Extensions', () => {
    const roots = resolveResourceRoots({
      projectRoot: '/tmp/storyflow-project',
      globalRoot: '/tmp/storyflow-global',
    });

    expect(roots.extensionsPath).toBe(resolve('/tmp/storyflow-global/extensions'));
  });
});
