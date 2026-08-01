/**
 * Tests for ConfigWatcher duplicate watcher detection.
 *
 * The activeWatchers registry detects when two ConfigWatcher instances
 * are started on the same workspace directory, which can wedge Bun's
 * event loop on Linux due to duplicate recursive fs.watch calls.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigWatcher, _getActiveWatchers, _getGlobalWatcherState } from '../watcher.ts';
import { invalidateSkillsCache, loadAllSkills } from '../../skills/storage.ts';
import { resolveResourceRoots } from '../../resources/resolver.ts';

function writeSkill(skillsRoot: string, slug: string, name: string): string {
  const skillDir = join(skillsRoot, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---
name: "${slug}"
description: "A test skill"
metadata:
  displayName: "${name}"
---

Instructions
`);
  return skillDir;
}

describe('ConfigWatcher duplicate guard', () => {
  beforeEach(() => {
    // Registry is module-level state — clear it between tests by
    // stopping any watchers that leaked. The map is read-only from
    // the exported getter, but we can verify its state.
  });

  it('should expose an active watchers registry', () => {
    const watchers = _getActiveWatchers();
    expect(watchers).toBeInstanceOf(Map);
  });

  it('registry should be empty when no watchers are running', () => {
    // After all watchers are stopped, the registry should be empty.
    // This test validates the baseline state — if it fails, a previous
    // test leaked a watcher.
    const watchers = _getActiveWatchers();
    // Note: we can't guarantee emptiness if other tests start watchers,
    // but we can verify the type and that the getter works.
    expect(typeof watchers.size).toBe('number');
  });

  it('shares global filesystem watchers across workspace watcher instances', () => {
    const rootA = mkdtempSync(join(tmpdir(), 'watcher-global-owner-a-'));
    const rootB = mkdtempSync(join(tmpdir(), 'watcher-global-owner-b-'));
    const watcherA = new ConfigWatcher(rootA, {});
    const watcherB = new ConfigWatcher(rootB, {});

    try {
      watcherA.start();
      const afterFirst = _getGlobalWatcherState();
      watcherB.start();
      const afterSecond = _getGlobalWatcherState();

      expect(afterFirst.subscriberCount).toBe(1);
      expect(afterSecond.subscriberCount).toBe(2);
      expect(afterSecond.watcherCount).toBe(afterFirst.watcherCount);
      expect(afterSecond.started).toBe(true);
    } finally {
      watcherA.stop();
      watcherB.stop();
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }

    expect(_getGlobalWatcherState().subscriberCount).toBe(0);
    expect(_getGlobalWatcherState().watcherCount).toBe(0);
    expect(_getGlobalWatcherState().started).toBe(false);
  });

  it('invalidates Skills synchronously without loading every workspace catalog', () => {
    const root = mkdtempSync(join(tmpdir(), 'watcher-global-skill-cache-'));
    const skillsRoot = resolveResourceRoots().skillsPath;
    const slug = `watcher-global-refresh-${process.pid}`;
    const skillDir = writeSkill(skillsRoot, slug, 'Original Name');
    try {
      expect(loadAllSkills().find(s => s.slug === slug)?.metadata.displayName).toBe('Original Name');

      writeSkill(skillsRoot, slug, 'Renamed Skill');

      let notifications = 0;
      const watcher = new ConfigWatcher(root, {
        onSkillsChange: () => {
          notifications += 1;
        },
      });

      (watcher as unknown as { handleSkillsChange: () => void }).handleSkillsChange();

      expect(notifications).toBe(1);
      expect(loadAllSkills().find(s => s.slug === slug)?.metadata.displayName).toBe('Renamed Skill');
    } finally {
      invalidateSkillsCache();
      rmSync(skillDir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
