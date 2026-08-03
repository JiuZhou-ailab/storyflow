-- input: Existing public Skills plus company-scoped publications
-- output: Explicit visibility and organization scope on each Skill
-- pos: Access-control metadata for catalog, detail, and bundle authorization

ALTER TABLE skills ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'company'));
ALTER TABLE skills ADD COLUMN organization_id TEXT;

CREATE INDEX skills_visibility_organization_idx ON skills(visibility, organization_id, updated_at DESC);
