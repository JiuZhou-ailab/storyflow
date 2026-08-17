-- input: Four published 1.0.1 bundles whose SKILL.md names match their install slugs
-- output: Importable current versions while preserving immutable 1.0.0 history
-- pos: One-time data repair aligning existing Market rows with the Pi runtime contract

INSERT OR IGNORE INTO skill_versions
  (id, skill_id, submitted_by, version, sha256, object_key, bytes, manifest_json, status,
   submitted_at, published_at, review_json, reviewed_at)
SELECT
  'migration-short-draft-chapter-1.0.1', id, owner_id, '1.0.1',
  '7cf4a60454efd72a32cf7ca1852344c5dac1dd3978529ca08d1b3fe3023e8da6',
  'packages/short-draft-chapter/1.0.1/7cf4a60454efd72a32cf7ca1852344c5dac1dd3978529ca08d1b3fe3023e8da6.json',
  1808,
  '{"schemaVersion":1,"slug":"short-draft-chapter","version":"1.0.1","displayName":"短篇章节起草","summary":"用于在 简报.md 和 大纲.md 已有可执行规划后，起草中文短篇网文的当前下一章。","license":"CC-BY-4.0","author":{"name":"派大星"},"tags":["网文","短篇","正文"]}',
  'published', '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z',
  '{"approve":true,"migration":"portable-skill-name","sourceVersion":"1.0.0"}',
  '2026-08-17T18:00:00.000Z'
FROM skills WHERE slug = 'short-draft-chapter';

INSERT OR IGNORE INTO skill_versions
  (id, skill_id, submitted_by, version, sha256, object_key, bytes, manifest_json, status,
   submitted_at, published_at, review_json, reviewed_at)
SELECT
  'migration-short-golden-three-1.0.1', id, owner_id, '1.0.1',
  '028d53f750c4f43e76088d7fdcc9cb28d2fe9e3fbcc2c03f7e3d0f6ba35b1b95',
  'packages/short-golden-three/1.0.1/028d53f750c4f43e76088d7fdcc9cb28d2fe9e3fbcc2c03f7e3d0f6ba35b1b95.json',
  1751,
  '{"schemaVersion":1,"slug":"short-golden-three","version":"1.0.1","displayName":"黄金三章规划","summary":"用于规划或修复中文短篇网文前三章的留存、升级、状态变化和兑现节奏。","license":"CC-BY-4.0","author":{"name":"派大星"},"tags":["网文","短篇","规划"]}',
  'published', '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z',
  '{"approve":true,"migration":"portable-skill-name","sourceVersion":"1.0.0"}',
  '2026-08-17T18:00:00.000Z'
FROM skills WHERE slug = 'short-golden-three';

INSERT OR IGNORE INTO skill_versions
  (id, skill_id, submitted_by, version, sha256, object_key, bytes, manifest_json, status,
   submitted_at, published_at, review_json, reviewed_at)
SELECT
  'migration-short-opening-designer-1.0.1', id, owner_id, '1.0.1',
  '4670d6b17f25606ad85af86967581d775471dde353164a5a99409556c1c32359',
  'packages/short-opening-designer/1.0.1/4670d6b17f25606ad85af86967581d775471dde353164a5a99409556c1c32359.json',
  2244,
  '{"schemaVersion":1,"slug":"short-opening-designer","version":"1.0.1","displayName":"短篇开篇设计","summary":"用于规划、诊断或修订中文短篇网文的第一屏、第一章开篇、开篇钩子，以及补全 简报.md 或 大纲.md 中的开篇设计。","license":"CC-BY-4.0","author":{"name":"派大星"},"tags":["网文","短篇","开篇"]}',
  'published', '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z',
  '{"approve":true,"migration":"portable-skill-name","sourceVersion":"1.0.0"}',
  '2026-08-17T18:00:00.000Z'
FROM skills WHERE slug = 'short-opening-designer';

INSERT OR IGNORE INTO skill_versions
  (id, skill_id, submitted_by, version, sha256, object_key, bytes, manifest_json, status,
   submitted_at, published_at, review_json, reviewed_at)
SELECT
  'migration-short-reviser-1.0.1', id, owner_id, '1.0.1',
  '156c8202befceb896911230b59422e66ddb20ffbafbbe05479046543aedbfee8',
  'packages/short-reviser/1.0.1/156c8202befceb896911230b59422e66ddb20ffbafbbe05479046543aedbfee8.json',
  1826,
  '{"schemaVersion":1,"slug":"short-reviser","version":"1.0.1","displayName":"短篇正文修订","summary":"用于诊断或修订既有中文短篇网文章节的留存、冲突、节奏、兑现、开篇突兀或开篇无力问题。","license":"CC-BY-4.0","author":{"name":"派大星"},"tags":["网文","短篇","修订"]}',
  'published', '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z',
  '{"approve":true,"migration":"portable-skill-name","sourceVersion":"1.0.0"}',
  '2026-08-17T18:00:00.000Z'
FROM skills WHERE slug = 'short-reviser';

UPDATE skills SET current_version_id = 'migration-short-draft-chapter-1.0.1', updated_at = '2026-08-17T18:00:00.000Z'
WHERE slug = 'short-draft-chapter';
UPDATE skills SET current_version_id = 'migration-short-golden-three-1.0.1', updated_at = '2026-08-17T18:00:00.000Z'
WHERE slug = 'short-golden-three';
UPDATE skills SET current_version_id = 'migration-short-opening-designer-1.0.1', updated_at = '2026-08-17T18:00:00.000Z'
WHERE slug = 'short-opening-designer';
UPDATE skills SET current_version_id = 'migration-short-reviser-1.0.1', updated_at = '2026-08-17T18:00:00.000Z'
WHERE slug = 'short-reviser';
