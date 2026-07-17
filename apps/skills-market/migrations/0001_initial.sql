-- input: Skills Market metadata and pending contribution records
-- output: Queryable immutable versions with author ownership and moderation state
-- pos: D1 source of truth; package bytes remain in private R2

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  access_subject TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  license TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, owner_id)
);

CREATE TABLE skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  version TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected', 'yanked')),
  rejection_reason TEXT,
  submitted_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY(skill_id, submitted_by) REFERENCES skills(id, owner_id),
  UNIQUE(skill_id, version),
  UNIQUE(sha256)
);

CREATE INDEX skill_versions_status_idx ON skill_versions(status, published_at DESC);
CREATE INDEX skill_versions_submitter_idx ON skill_versions(submitted_by, submitted_at DESC);
CREATE INDEX skills_updated_idx ON skills(updated_at DESC);
