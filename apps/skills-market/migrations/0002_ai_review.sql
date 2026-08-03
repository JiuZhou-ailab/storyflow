-- input: Published Skill versions admitted by automated review
-- output: Review evidence stored beside the immutable version
-- pos: Minimal audit trail for the synchronous publication boundary

ALTER TABLE skill_versions ADD COLUMN review_json TEXT;
ALTER TABLE skill_versions ADD COLUMN reviewed_at TEXT;
