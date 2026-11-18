-- Defense, phase 4: the moderator in DMs (docs/DEFENSE.md).
--
-- One Bluesky account, Virga's moderator, that owners DM. Its conversations
-- are read by the worker on the droplet, which holds the account; every
-- message it answers comes here through Vercel's moderator route
-- (server/defense/handlers/moderator.js), signed. This holds what linking and
-- the agent's allowance need, and no message text: a DM is answered and then
-- dropped.
--
--   defense_link        an owner's link to the moderator, and the list its adds go to
--   defense_dm_stranger when someone who hasn't linked was last answered, by a
--                       hash of their DID, so the moderator says its one line at
--                       most once a day and keeps no list of who wrote to it
--   defense_agent_usage how many agent turns each owner has had this month
--   defense_agent_turn  each real DM an agent turn answers, as Vercel read it
--                       from the chat service: the agent's tool calls name one,
--                       and a turn has a few minutes and a few writes
--   defense_verifier    Vercel's own session for the moderator account, made
--                       with an app password the droplet doesn't have, for
--                       reading back each message the droplet says it got
--
-- Every function that reads or writes a link takes its owner first, as phase
-- 3's do (docs/DEFENSE-THREATS.md, rule 4). Granted to service_role only.

-- ─── Linking ────────────────────────────────────────────────────────────────
-- Settings shows a short code; the owner sends it to the moderator from the
-- same account. The code is stored only as a hash of the owner's DID and the
-- code, so it links that account and no other whoever sends it, lives fifteen
-- minutes, and is spent by a fifth wrong try.
CREATE TABLE IF NOT EXISTS virga.defense_link (
  owner_did        TEXT PRIMARY KEY CHECK (owner_did ~ '^did:[a-z]+:[a-zA-Z0-9._:%-]+$' AND char_length(owner_did) <= 512),
  code_hash        TEXT CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  code_expires_at  TIMESTAMPTZ,
  code_tries       SMALLINT NOT NULL DEFAULT 0 CHECK (code_tries BETWEEN 0 AND 100),
  linked_at        TIMESTAMPTZ,
  -- The list "block @someone" adds to. Null: the owner's only list, if they
  -- have one, and asked otherwise.
  list_id          UUID REFERENCES virga.defense_list(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Strangers, and the agent's allowance ────────────────────────────────
CREATE TABLE IF NOT EXISTS virga.defense_dm_stranger (
  sender_hash  TEXT PRIMARY KEY CHECK (sender_hash ~ '^[0-9a-f]{64}$'),
  answered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A turn is one message the agent answered, whatever it called. Counted
-- before the model is asked, so a turn that fails still counts.
CREATE TABLE IF NOT EXISTS virga.defense_agent_usage (
  owner_did  TEXT NOT NULL CHECK (char_length(owner_did) <= 512),
  month      DATE NOT NULL,
  turns      INTEGER NOT NULL DEFAULT 0 CHECK (turns >= 0),
  PRIMARY KEY (owner_did, month)
);

-- A message an agent turn answers. Its id is what the agent's tool calls
-- carry: random, so only the worker that was handed it can name it, and good
-- only for its owner, for TURN_MINUTES, for so many writes. No text: the
-- message is read again from the chat service whenever its words are needed.
CREATE TABLE IF NOT EXISTS virga.defense_agent_turn (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_did   TEXT NOT NULL CHECK (char_length(owner_did) <= 512),
  convo_id    TEXT NOT NULL CHECK (char_length(convo_id) BETWEEN 1 AND 200),
  message_id  TEXT NOT NULL CHECK (char_length(message_id) BETWEEN 1 AND 200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  writes      SMALLINT NOT NULL DEFAULT 0 CHECK (writes >= 0),
  UNIQUE (owner_did, message_id)
);
CREATE INDEX IF NOT EXISTS idx_defense_agent_turn_created ON virga.defense_agent_turn(created_at);

-- Vercel's session for the moderator account, sealed with
-- SESSION_ENCRYPTION_KEY. One row.
CREATE TABLE IF NOT EXISTS virga.defense_verifier (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  session     TEXT CHECK (session IS NULL OR char_length(session) <= 16384),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE virga.defense_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.defense_dm_stranger ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.defense_agent_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.defense_agent_turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.defense_verifier ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE virga.defense_link, virga.defense_dm_stranger, virga.defense_agent_usage, virga.defense_agent_turn, virga.defense_verifier FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE virga.defense_link, virga.defense_dm_stranger, virga.defense_agent_usage, virga.defense_agent_turn, virga.defense_verifier TO service_role;

-- ─── A code, made ───────────────────────────────────────────────────────────
-- A new code replaces the last; an account already linked stays linked.
CREATE OR REPLACE FUNCTION virga.defense_link_code(
  p_owner_did TEXT,
  p_code_hash TEXT,
  p_expires   TIMESTAMPTZ
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  INSERT INTO defense_link (owner_did, code_hash, code_expires_at, code_tries, updated_at)
    VALUES (p_owner_did, p_code_hash, p_expires, 0, NOW())
  ON CONFLICT (owner_did) DO UPDATE
    SET code_hash = EXCLUDED.code_hash, code_expires_at = EXCLUDED.code_expires_at, code_tries = 0, updated_at = NOW();
  RETURN p_expires;
END;
$$;

-- ─── A code, sent ───────────────────────────────────────────────────────────
-- What came of an owner sending a code: 'linked', 'wrong', 'expired' or
-- 'none' (no code waiting). A code is spent when it links, when it has
-- expired, and at the fifth wrong try.
CREATE OR REPLACE FUNCTION virga.defense_link_claim(
  p_owner_did TEXT,
  p_code_hash TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
DECLARE
  v_link defense_link%ROWTYPE;
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  SELECT * INTO v_link FROM defense_link WHERE owner_did = p_owner_did FOR UPDATE;
  IF NOT FOUND OR v_link.code_hash IS NULL THEN RETURN 'none'; END IF;
  IF v_link.code_expires_at IS NULL OR v_link.code_expires_at <= NOW() THEN
    UPDATE defense_link SET code_hash = NULL, code_expires_at = NULL, code_tries = 0, updated_at = NOW() WHERE owner_did = p_owner_did;
    RETURN 'expired';
  END IF;
  IF v_link.code_hash = p_code_hash THEN
    UPDATE defense_link
       SET linked_at = NOW(), code_hash = NULL, code_expires_at = NULL, code_tries = 0, updated_at = NOW()
     WHERE owner_did = p_owner_did;
    RETURN 'linked';
  END IF;
  IF v_link.code_tries + 1 >= 5 THEN
    UPDATE defense_link SET code_hash = NULL, code_expires_at = NULL, code_tries = 0, updated_at = NOW() WHERE owner_did = p_owner_did;
  ELSE
    UPDATE defense_link SET code_tries = code_tries + 1, updated_at = NOW() WHERE owner_did = p_owner_did;
  END IF;
  RETURN 'wrong';
END;
$$;

-- ─── The list the moderator adds to ─────────────────────────────────────────
-- Only one of the owner's own lists, still kept; null clears it. False when
-- the list isn't theirs.
CREATE OR REPLACE FUNCTION virga.defense_link_list(
  p_owner_did TEXT,
  p_list_id   UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  IF p_list_id IS NOT NULL THEN
    PERFORM 1 FROM defense_list WHERE id = p_list_id AND owner_did = p_owner_did AND removed_at IS NULL;
    IF NOT FOUND THEN RETURN FALSE; END IF;
  END IF;
  INSERT INTO defense_link (owner_did, list_id, updated_at) VALUES (p_owner_did, p_list_id, NOW())
  ON CONFLICT (owner_did) DO UPDATE SET list_id = EXCLUDED.list_id, updated_at = NOW();
  RETURN TRUE;
END;
$$;

-- ─── One account, named ─────────────────────────────────────────────────────
-- "block @someone": an add of one account the owner named, with no band (it
-- came from no scan). Returns 'queued' with its job, or why not: 'list' (not
-- the owner's list), 'self', 'kept' (kept off by hand) or 'already' (a live
-- add for them on this list). The veto at the write still decides.
CREATE OR REPLACE FUNCTION virga.defense_add_named(
  p_owner_did TEXT,
  p_list_id   UUID,
  p_did       TEXT,
  p_note      TEXT,
  p_via       TEXT DEFAULT 'dm'
) RETURNS TABLE (outcome TEXT, job_id UUID, decision_id BIGINT)
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_job UUID;
  v_decision BIGINT;
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  PERFORM 1 FROM defense_list WHERE id = p_list_id AND owner_did = p_owner_did AND removed_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'list'::TEXT, NULL::UUID, NULL::BIGINT; RETURN; END IF;
  IF p_did = p_owner_did THEN RETURN QUERY SELECT 'self'::TEXT, NULL::UUID, NULL::BIGINT; RETURN; END IF;
  -- One add for a list at a time, as defense_approve_plan holds it.
  PERFORM pg_advisory_xact_lock(hashtext('virga.defense_list'), hashtext(p_list_id::text));
  PERFORM 1 FROM defense_protected WHERE owner_did = p_owner_did AND did = p_did;
  IF FOUND THEN RETURN QUERY SELECT 'kept'::TEXT, NULL::UUID, NULL::BIGINT; RETURN; END IF;
  PERFORM 1 FROM defense_decision d
   WHERE d.list_id = p_list_id AND d.subject_did = p_did AND d.action = 'add'
     AND d.state IN ('queued', 'sent', 'done', 'already') AND d.undone_at IS NULL;
  IF FOUND THEN RETURN QUERY SELECT 'already'::TEXT, NULL::UUID, NULL::BIGINT; RETURN; END IF;

  INSERT INTO defense_job (owner_did, list_id, kind) VALUES (p_owner_did, p_list_id, 'add') RETURNING id INTO v_job;
  INSERT INTO defense_decision (owner_did, list_id, job_id, subject_did, action, via, note)
    VALUES (p_owner_did, p_list_id, v_job, p_did, 'add',
            CASE WHEN p_via IN ('web', 'dm', 'shield') THEN p_via ELSE 'dm' END, p_note)
    RETURNING id INTO v_decision;
  RETURN QUERY SELECT 'queued'::TEXT, v_job, v_decision;
END;
$$;

-- ─── A plan by its code ─────────────────────────────────────────────────────
-- A DM names a plan by the first eight hex digits of its id. The owner's
-- plans only; two that share a code (one in four billion) are both returned,
-- and the caller refuses to choose.
CREATE OR REPLACE FUNCTION virga.defense_plan_by_code(
  p_owner_did TEXT,
  p_code      TEXT
) RETURNS SETOF virga.defense_plan
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  IF p_code IS NULL OR p_code !~ '^[0-9a-f]{8}$' THEN RETURN; END IF;
  RETURN QUERY
    SELECT * FROM defense_plan
     WHERE owner_did = p_owner_did AND left(replace(id::text, '-', ''), 8) = p_code
     ORDER BY created_at DESC
     LIMIT 2;
END;
$$;

-- Whether to answer someone who hasn't linked: true at most once a day per
-- sender, and the time is set as it answers.
CREATE OR REPLACE FUNCTION virga.defense_dm_stranger_due(
  p_sender_hash TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
BEGIN
  INSERT INTO defense_dm_stranger (sender_hash, answered_at) VALUES (p_sender_hash, NOW())
  ON CONFLICT (sender_hash) DO UPDATE SET answered_at = NOW()
    WHERE defense_dm_stranger.answered_at < NOW() - INTERVAL '1 day';
  RETURN FOUND;
END;
$$;

-- An agent turn, counted against the owner's monthly allowance: the turns
-- used this month after this one, or NULL when the allowance is spent (and
-- nothing is counted). A NULL limit is unlimited.
CREATE OR REPLACE FUNCTION virga.defense_agent_count(
  p_owner_did TEXT,
  p_limit     INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
DECLARE
  v_month DATE := date_trunc('month', NOW() AT TIME ZONE 'UTC')::DATE;
  v_turns INTEGER;
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  INSERT INTO defense_agent_usage (owner_did, month, turns) VALUES (p_owner_did, v_month, 0)
    ON CONFLICT (owner_did, month) DO NOTHING;
  UPDATE defense_agent_usage
     SET turns = turns + 1
   WHERE owner_did = p_owner_did AND month = v_month AND (p_limit IS NULL OR turns < p_limit)
  RETURNING turns INTO v_turns;
  RETURN v_turns;
END;
$$;

-- A turn for a message Vercel has read back: the turn's id, the same one for
-- the same message. A new turn is counted against the owner's monthly
-- allowance when p_count, and none is opened (NULL) once it is spent. Turns
-- older than a day are cleared as new ones open.
CREATE OR REPLACE FUNCTION virga.defense_agent_turn_open(
  p_owner_did  TEXT,
  p_convo_id   TEXT,
  p_message_id TEXT,
  p_limit      INTEGER,
  p_count      BOOLEAN DEFAULT TRUE
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  SELECT id INTO v_id FROM defense_agent_turn WHERE owner_did = p_owner_did AND message_id = p_message_id;
  IF FOUND THEN RETURN v_id; END IF;
  IF p_count AND defense_agent_count(p_owner_did, p_limit) IS NULL THEN RETURN NULL; END IF;
  DELETE FROM defense_agent_turn WHERE created_at < NOW() - INTERVAL '1 day';
  INSERT INTO defense_agent_turn (owner_did, convo_id, message_id) VALUES (p_owner_did, p_convo_id, p_message_id)
    ON CONFLICT (owner_did, message_id) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM defense_agent_turn WHERE owner_did = p_owner_did AND message_id = p_message_id;
  END IF;
  RETURN v_id;
END;
$$;

-- One write of a turn's, if it is the owner's, still fresh (p_minutes), and
-- under p_max writes: true and counted, or false.
CREATE OR REPLACE FUNCTION virga.defense_agent_turn_write(
  p_owner_did TEXT,
  p_turn_id   UUID,
  p_minutes   INTEGER,
  p_max       INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  UPDATE defense_agent_turn
     SET writes = writes + 1
   WHERE id = p_turn_id AND owner_did = p_owner_did AND writes < p_max
     AND created_at > NOW() - make_interval(mins => GREATEST(1, p_minutes));
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION virga.defense_link_code(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_link_claim(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_link_list(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_add_named(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_plan_by_code(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_dm_stranger_due(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_agent_count(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_agent_turn_open(TEXT, TEXT, TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_agent_turn_write(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION virga.defense_link_code(TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_link_claim(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_link_list(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_add_named(TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_plan_by_code(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_dm_stranger_due(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_agent_count(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_agent_turn_open(TEXT, TEXT, TEXT, INTEGER, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_agent_turn_write(TEXT, UUID, INTEGER, INTEGER) TO service_role;
