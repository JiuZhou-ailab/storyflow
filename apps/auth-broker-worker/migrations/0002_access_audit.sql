ALTER TABLE access_accounts ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'identity-exchange';
-- statement
ALTER TABLE access_sessions ADD COLUMN revoked_by TEXT;
-- statement
CREATE TRIGGER access_account_audit AFTER UPDATE ON access_accounts BEGIN
  INSERT INTO access_audit(id, actor, target, operation, occurred_at, details) VALUES (lower(hex(randomblob(16))), NEW.updated_by, NEW.subject, CASE WHEN OLD.enabled != NEW.enabled THEN CASE WHEN NEW.enabled = 1 THEN 'account_enabled' ELSE 'account_disabled' END ELSE 'account_policy_changed' END, unixepoch(), json_object('enabled', NEW.enabled, 'scopes', json(NEW.scopes), 'models', json(NEW.models)));
  UPDATE access_sessions SET revoked_at = COALESCE(revoked_at, unixepoch()), revoked_by = NEW.updated_by WHERE subject = NEW.subject AND NEW.enabled = 0 AND revoked_at IS NULL;
END;
-- statement
CREATE TRIGGER access_session_audit AFTER UPDATE OF revoked_at ON access_sessions WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
  INSERT INTO access_audit(id, actor, target, operation, occurred_at) VALUES (lower(hex(randomblob(16))), COALESCE(NEW.revoked_by, NEW.subject), NEW.sid, 'session_revoked', unixepoch());
END;
