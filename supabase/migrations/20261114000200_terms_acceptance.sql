-- The record that an account agreed to Virga's Terms of Service and Privacy
-- Policy (server/terms/*). A row is written when someone presses Agree on the
-- way in, and is never changed afterwards. Only the service role (which
-- bypasses RLS) touches it, and it may only read rows and add them. Safe to
-- re-apply.

-- Virga's own schema; see the first migration.
CREATE SCHEMA IF NOT EXISTS virga;
REVOKE ALL ON SCHEMA virga FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA virga TO service_role;

-- terms_acceptance: who agreed to which version of the documents, and how the
-- account was known. A long session's agreement is one row per account and
-- version: agreeing again (another device, a retry after a dropped
-- connection) finds the first row rather than adding one.
--
-- The columns follow the other apps' ledgers in the same project
-- (public.anisota_terms_acceptance, public.rainshare_terms_acceptance: did,
-- policy_version, document, accepted_at), so the three read alike.
--
-- terms_version is the number the gate compares (TERMS_VERSION,
-- src/legal/version.js); policy_version is the date those documents carry
-- (TERMS_EFFECTIVE_DATE, as YYYY-MM-DD), which is what the other ledgers call
-- a version. The server writes both from that one module; a caller never
-- chooses either.
--
-- identity says how far `did` can be trusted:
--   'session'  read by the server from the caller's long session, which the
--              account's own host vouched for at sign-in
--   'claimed'  reported by a browser holding a browser session, which the
--              server has no part in and can't check
-- Only a 'session' row answers "has this account agreed?" (GET
-- /api/terms/status). A 'claimed' row is a note of what a browser said, with
-- the address it said it from; it is nobody's one record, because anyone can
-- name any account. So a claim is kept once per account, version and address:
-- the same browser reporting twice adds nothing, and a stranger naming an
-- account first can't put their address where the account's own would go.
--
-- ip and user_agent are context for the record, taken from the request as it
-- arrived. They aren't identity. The address is read back for one thing: to
-- count how many claims it has made lately.
CREATE TABLE IF NOT EXISTS virga.terms_acceptance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did            TEXT NOT NULL CHECK (char_length(did) <= 512), -- the account that agreed
  policy_version TEXT NOT NULL,                              -- the documents' "Last updated" date, YYYY-MM-DD
  terms_version  INTEGER NOT NULL CHECK (terms_version > 0), -- TERMS_VERSION
  document       TEXT NOT NULL DEFAULT 'tos+privacy',        -- both, always: they are agreed to together
  identity       TEXT NOT NULL CHECK (identity IN ('session', 'claimed')),
  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip             TEXT CHECK (ip IS NULL OR char_length(ip) <= 64),
  user_agent     TEXT CHECK (user_agent IS NULL OR char_length(user_agent) <= 512)
);

-- A long session's first agreement stands; a second insert for the same
-- account and version is refused (23505), and the server answers with the
-- first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_acceptance_session
  ON virga.terms_acceptance(did, terms_version) WHERE identity = 'session';

-- A claim, once per account, version and address (an unknown address counts
-- as one address).
CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_acceptance_claim
  ON virga.terms_acceptance(did, terms_version, COALESCE(ip, '')) WHERE identity = 'claimed';

-- The claims one address has made lately: the server counts them before it
-- takes another, so the table can't be filled from one place
-- (recordClaim, server/terms/acceptance.js).
CREATE INDEX IF NOT EXISTS idx_terms_acceptance_claims_by_address
  ON virga.terms_acceptance(ip, accepted_at) WHERE identity = 'claimed';

COMMENT ON TABLE virga.terms_acceptance IS
  'Who agreed to which version of Virga''s Terms of Service and Privacy Policy, and when. Append-only. Service role only.';

-- Service role only: RLS on with no policies, and nothing for the roles the
-- public API key maps to. Unlike Virga's other tables, the service role is
-- left with SELECT and INSERT alone: the server's key can't rewrite or remove
-- a row, so the record is append-only by privilege rather than by convention.
-- Removing someone's rows (an erasure request) is done by the project's
-- owner, in the SQL editor.
ALTER TABLE virga.terms_acceptance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE virga.terms_acceptance FROM anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE virga.terms_acceptance TO service_role;
