-- The record that an account agreed to Virga's Terms of Service and Privacy
-- Policy (server/terms/*). A row is written when someone presses Agree on the
-- way in, and is never changed afterwards. Only the service role (which
-- bypasses RLS) touches it, and it may only read rows and add them. Safe to
-- re-apply.

-- terms_acceptance: one row per account, per version of the documents, per
-- way the account was known. Agreeing again (another device, a retry after a
-- dropped connection) finds the first row rather than adding one, so the
-- table grows with accounts and versions, not with requests.
--
-- identity says how far `did` can be trusted:
--   'session'  read by the server from the caller's long session, which the
--              account's own host vouched for at sign-in
--   'claimed'  reported by a browser holding a browser session, which the
--              server has no part in and can't check
-- Only a 'session' row answers "has this account agreed?" (GET
-- /api/terms/status); a 'claimed' row is kept as a note of what a browser
-- said, with the address it said it from.
--
-- ip and user_agent are context for the record, taken from the request as it
-- arrived. They aren't identity, and nothing reads them back.
CREATE TABLE IF NOT EXISTS terms_acceptance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did            TEXT NOT NULL,                              -- the account that agreed
  terms_version  INTEGER NOT NULL CHECK (terms_version > 0), -- TERMS_VERSION (src/legal/version.js)
  effective_date DATE NOT NULL,                              -- the "Last updated" date of the documents shown
  identity       TEXT NOT NULL CHECK (identity IN ('session', 'claimed')),
  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip             TEXT,
  user_agent     TEXT
);

-- The first agreement stands; a second insert for the same account, version
-- and identity is refused (23505), and the server answers with the first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_acceptance_once ON terms_acceptance(did, terms_version, identity);

COMMENT ON TABLE terms_acceptance IS 'Who agreed to which version of Virga''s Terms of Service and Privacy Policy, and when. Append-only. Service role only.';

-- Service role only: RLS on with no policies, and nothing granted to the
-- roles the public API key maps to (Supabase grants them new public objects by
-- default). The service role is left with SELECT and INSERT alone: the
-- server's key can't rewrite or remove a row, so the record is append-only by
-- privilege rather than by convention. Removing someone's rows (an erasure
-- request) is done by the project's owner, in the SQL editor.
ALTER TABLE terms_acceptance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE terms_acceptance FROM anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE terms_acceptance TO service_role;
