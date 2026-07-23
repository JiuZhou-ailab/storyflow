// input: Temporary absolute roots representing global and project resource scopes
// output: Proof of explicit project overlays, global-only Extensions, and stable precedence
// pos: Unit contract for Storyflow's single resource-root resolver

import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { CONFIG_DIR } from '../../config/paths.ts';
import { resolveResourceRoots } from '../resolver.ts';

describe('resolveResourceRoots', () => {
  it('resolves a global-only scope when projectRoot is absent', () => {
    const roots = resolveResourceRoots();

    expect(roots).toEqual({
      skills: [{
        origin: 'global',
        rootPath: resolve(CONFIG_DIR),
        path: resolve(CONFIG_DIR, 'skills'),
      }],
      sources: [{
        origin: 'global',
        rootPath: resolve(CONFIG_DIR),
        path: resolve(CONFIG_DIR, 'sources'),
      }],
      extensions: [{
        origin: 'global',
        rootPath: resolve(CONFIG_DIR),
        path: resolve(CONFIG_DIR, 'extensions'),
      }],
    });
  });

  it('places project Skills and Sources before global resources', () => {
    const roots = resolveResourceRoots({
      projectRoot: '/tmp/storyflow-project',
      globalRoot: '/tmp/storyflow-global',
    });

    expect(roots.skills.map(root => root.origin)).toEqual(['project', 'global']);
    expect(roots.skills.map(root => root.path)).toEqual([
      resolve('/tmp/storyflow-project/.pi/skills'),
      resolve('/tmp/storyflow-global/skills'),
    ]);
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

    expect(roots.extensions).toEqual([{
      origin: 'global',
      rootPath: resolve('/tmp/storyflow-global'),
      path: resolve('/tmp/storyflow-global/extensions'),
    }]);
  });
});
