CREATE TABLE access_accounts (
  subject TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  scopes TEXT NOT NULL CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
  models TEXT CHECK (models IS NULL OR (json_valid(models) AND json_type(models) = 'array')),
  updated_at INTEGER NOT NULL
);
CREATE TABLE access_sessions (
  sid TEXT PRIMARY KEY,
  subject TEXT NOT NULL REFERENCES access_accounts(subject),
  authenticated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX access_sessions_subject ON access_sessions(subject);
CREATE TABLE access_audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  target TEXT NOT NULL,
  operation TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  result TEXT NOT NULL DEFAULT 'applied' CHECK (result = 'applied'),
  details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details))
);
