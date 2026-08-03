-- input: Successful Market bundle downloads for curated and member-published Skills
-- output: Atomic per-Skill popularity counters used by catalog ranking
-- pos: D1 aggregate metrics; download events are not retained individually

CREATE TABLE skill_metrics (
  slug TEXT PRIMARY KEY,
  download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  updated_at TEXT NOT NULL
);

CREATE INDEX skill_metrics_downloads_idx ON skill_metrics(download_count DESC, slug);
