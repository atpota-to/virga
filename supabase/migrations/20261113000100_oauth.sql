-- Virga's confidential atproto OAuth client (server/oauth/*): the library's
-- session and state stores, the browser's session tokens, and the
-- cross-instance refresh lock. Only the service role (which bypasses RLS)
-- touches any of it. Safe to re-apply.

-- Everything Virga keeps is in its own schema, `virga`, so it can share a
-- Supabase project with other apps: nothing here creates, replaces or drops
-- an object in `public`. Every statement names the schema, and every function
-- pins its search_path to it. The server reaches the schema through the Data
-- API, so `virga` has to be added to the project's exposed schemas (API
-- settings); nothing else needs granting. Each migration opens with these
-- three statements so that it stands on its own.
CREATE SCHEMA IF NOT EXISTS virga;
REVOKE ALL ON SCHEMA virga FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA virga TO service_role;

-- updated_at maintenance. Defined here with CREATE OR REPLACE so this file
-- stands on its own; later migrations that need it do the same.
CREATE OR REPLACE FUNCTION virga.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- oauth_sessions: one atproto OAuth session per DID, written by
-- @atproto/oauth-client-node at sign-in and on every refresh. session_data is
-- an AES-GCM envelope when SESSION_ENCRYPTION_KEY is set
-- (server/oauth/sessionCrypto.js). Only a sign-out deletes a row.
CREATE TABLE IF NOT EXISTS virga.oauth_sessions (
  sub          TEXT PRIMARY KEY,               -- the account's DID
  session_data JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- oauth_state: an authorization in flight, keyed by the library's state
-- param. Read once at the callback (and deleted then), or expired after an hour.
CREATE TABLE IF NOT EXISTS virga.oauth_state (
  key        TEXT PRIMARY KEY,
  state_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour'
);

-- frontend_sessions: the browser's opaque `vg_` tokens, one per sign-in per
-- device. expires_at slides forward while the token is in use. Only the
-- token's SHA-256 (hex) is stored, so a dump or a backup holds nothing a
-- request could present (FrontendSessionStore, tokenKey).
CREATE TABLE IF NOT EXISTS virga.frontend_sessions (
  token_hash TEXT PRIMARY KEY,
  user_did   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON virga.oauth_state(expires_at);
CREATE INDEX IF NOT EXISTS idx_frontend_sessions_expires ON virga.frontend_sessions(expires_at);
-- Per-device sign-out counts a DID's live tokens (countForUser).
CREATE INDEX IF NOT EXISTS idx_frontend_sessions_user_did ON virga.frontend_sessions(user_did, expires_at);

DROP TRIGGER IF EXISTS update_oauth_sessions_updated_at ON virga.oauth_sessions;
CREATE TRIGGER update_oauth_sessions_updated_at
  BEFORE UPDATE ON virga.oauth_sessions
  FOR EACH ROW
  EXECUTE FUNCTION virga.update_updated_at_column();

-- oauth_locks: serializes one DID's token refresh across serverless
-- instances. Refresh tokens are single-use and rotating; two instances
-- refreshing at once get the session revoked as a replay.
CREATE TABLE IF NOT EXISTS virga.oauth_locks (
  key         TEXT PRIMARY KEY,                 -- '@atproto-oauth-client-<did>'
  holder      TEXT NOT NULL,                    -- random per acquisition
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL              -- a crashed holder can't block anyone for long
);
CREATE INDEX IF NOT EXISTS idx_oauth_locks_expires ON virga.oauth_locks(expires_at);

-- Take the lock when it is free or expired. TRUE only if p_holder now holds it.
CREATE OR REPLACE FUNCTION virga.acquire_oauth_lock(
  p_key TEXT,
  p_holder TEXT,
  p_ttl_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
DECLARE
  v_holder TEXT;
BEGIN
  INSERT INTO oauth_locks (key, holder, acquired_at, expires_at)
  VALUES (p_key, p_holder, NOW(), NOW() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (key) DO UPDATE
    SET holder = EXCLUDED.holder,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at
    WHERE oauth_locks.expires_at < NOW();

  SELECT holder INTO v_holder FROM oauth_locks WHERE key = p_key;
  RETURN v_holder = p_holder;
END;
$$;

-- Release only a lock still held by p_holder.
CREATE OR REPLACE FUNCTION virga.release_oauth_lock(
  p_key TEXT,
  p_holder TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
BEGIN
  DELETE FROM oauth_locks WHERE key = p_key AND holder = p_holder;
END;
$$;

-- Service role only: RLS on with no policies, and nothing granted to the
-- roles the public API key maps to. Supabase's guide to exposing a schema
-- grants those roles everything in it; if that was run, this takes it back.
ALTER TABLE virga.oauth_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.oauth_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.frontend_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.oauth_locks       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE virga.oauth_sessions    FROM anon, authenticated;
REVOKE ALL ON TABLE virga.oauth_state       FROM anon, authenticated;
REVOKE ALL ON TABLE virga.frontend_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE virga.oauth_locks       FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE virga.oauth_sessions, virga.oauth_state, virga.frontend_sessions, virga.oauth_locks TO service_role;

REVOKE ALL ON FUNCTION virga.acquire_oauth_lock(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.release_oauth_lock(TEXT, TEXT)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.update_updated_at_column()              FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION virga.acquire_oauth_lock(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION virga.release_oauth_lock(TEXT, TEXT)          TO service_role;
