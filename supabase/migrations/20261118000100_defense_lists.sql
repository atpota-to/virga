-- Defense, phase 3: the lists Virga keeps for an owner, the plans a scan
-- proposes, every decision to add or remove someone, the people kept by hand,
-- and the jobs that write the lists (docs/DEFENSE.md, docs/DEFENSE-THREATS.md).
--
-- Every row carries owner_did, and every function here takes the owner as a
-- required argument and touches nothing of anyone else's. The server reaches
-- these tables only through server/defense/store.js, which is bound to one
-- owner (threat model, rule 4). No handles, names or post text are kept: a
-- plan and a decision name DIDs, bands and trust keys, and the owner's own
-- words. Safe to re-apply.

CREATE SCHEMA IF NOT EXISTS virga;
REVOKE ALL ON SCHEMA virga FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA virga TO service_role;

-- ─── Lists ──────────────────────────────────────────────────────────────────
-- A moderation list Virga made for an owner. `holder_did` is the account the
-- list record is in: the owner's own ('own'), or a helper account of theirs
-- ('helper'), signed in to Virga. `purpose` is how the owner means to use it
-- (they subscribe to it in their client as a block list or a mute list).
CREATE TABLE IF NOT EXISTS virga.defense_list (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_did   TEXT NOT NULL CHECK (owner_did ~ '^did:[a-z]+:[a-zA-Z0-9._:%-]+$' AND char_length(owner_did) <= 512),
  holder_did  TEXT NOT NULL CHECK (holder_did ~ '^did:[a-z]+:[a-zA-Z0-9._:%-]+$' AND char_length(holder_did) <= 512),
  mode        TEXT NOT NULL CHECK (mode IN ('own', 'helper')),
  uri         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  purpose     TEXT NOT NULL CHECK (purpose IN ('block', 'mute')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at  TIMESTAMPTZ,
  -- The list record is in the holder's repo, and nowhere else.
  CONSTRAINT defense_list_uri_in_holder CHECK (uri = 'at://' || holder_did || '/app.bsky.graph.list/' || split_part(uri, '/', 5)
    AND split_part(uri, '/', 5) ~ '^[a-zA-Z0-9._:~-]+$' AND char_length(uri) <= 1100),
  CONSTRAINT defense_list_own_is_owner CHECK (mode <> 'own' OR holder_did = owner_did)
);
CREATE INDEX IF NOT EXISTS idx_defense_list_owner ON virga.defense_list(owner_did);

-- ─── Kept by hand ───────────────────────────────────────────────────────────
-- Accounts the owner keeps off every list, in their own words. Read by the
-- veto at every write (src/defense/veto.js).
CREATE TABLE IF NOT EXISTS virga.defense_protected (
  owner_did  TEXT NOT NULL CHECK (char_length(owner_did) <= 512),
  did        TEXT NOT NULL CHECK (did ~ '^did:[a-z]+:[a-zA-Z0-9._:%-]+$' AND char_length(did) <= 512),
  reason     TEXT NOT NULL DEFAULT 'kept by hand' CHECK (char_length(reason) BETWEEN 1 AND 200),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_did, did)
);

-- ─── Plans ──────────────────────────────────────────────────────────────────
-- A batch a scan proposed for one list: who engaged with a post, by band. Kept
-- 30 days unless something was written from it (expires_at is cleared then).
CREATE TABLE IF NOT EXISTS virga.defense_plan (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_did       TEXT NOT NULL CHECK (char_length(owner_did) <= 512),
  list_id         UUID NOT NULL REFERENCES virga.defense_list(id) ON DELETE CASCADE,
  post_uri        TEXT CHECK (post_uri IS NULL OR (post_uri LIKE 'at://%' AND char_length(post_uri) <= 512)),
  totals          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at     TIMESTAMPTZ,
  approved_bands  TEXT[] NOT NULL DEFAULT '{}',
  note            TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);
CREATE INDEX IF NOT EXISTS idx_defense_plan_owner ON virga.defense_plan(owner_did, created_at DESC);

-- One account in a plan. PROTECTED is never in one.
CREATE TABLE IF NOT EXISTS virga.defense_plan_row (
  plan_id  UUID NOT NULL REFERENCES virga.defense_plan(id) ON DELETE CASCADE,
  did      TEXT NOT NULL CHECK (did ~ '^did:[a-z]+:[a-zA-Z0-9._:%-]+$' AND char_length(did) <= 512),
  band     TEXT NOT NULL CHECK (band IN ('CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN')),
  trust    SMALLINT CHECK (trust IS NULL OR trust BETWEEN 0 AND 100),
  PRIMARY KEY (plan_id, did)
);

-- ─── Jobs ───────────────────────────────────────────────────────────────────
-- Writes in progress for one list, so a run that ends carries on at the next.
-- The run route (server/defense/run.js) claims due jobs a holder at a time.
CREATE TABLE IF NOT EXISTS virga.defense_job (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_did   TEXT NOT NULL CHECK (char_length(owner_did) <= 512),
  list_id     UUID NOT NULL REFERENCES virga.defense_list(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('add', 'remove')),
  state       TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at   TIMESTAMPTZ,
  last_error  TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_defense_job_due ON virga.defense_job(next_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_defense_job_owner ON virga.defense_job(owner_did, created_at DESC);

-- When each holder may next be written to: one batch per gap, whichever of
-- its lists it is for, so the holder's PDS limits hold across them all.
CREATE TABLE IF NOT EXISTS virga.defense_pace (
  holder_did  TEXT PRIMARY KEY CHECK (char_length(holder_did) <= 512),
  next_at     TIMESTAMPTZ NOT NULL
);

-- ─── Decisions ──────────────────────────────────────────────────────────────
-- Every add and every removal, kept for good: it's what "why is this person
-- on the list" and undo read. `rkey` is the list item's record key, chosen
-- before the write is sent, so a write whose reply was lost is sent again
-- under the same key and can't land twice, and a removal deletes exactly what
-- the add wrote.
--   queued    approved, not sent yet
--   sent      sent; its reply not yet recorded (a run that died, or a lost reply)
--   done      written (an add's item is on the list; a removal's is gone)
--   already   an add whose item was there already, or a removal of one that wasn't
--   vetoed    refused at the write by the veto; `reason` says why
--   failed    refused for good by the PDS; `reason` says why
--   cancelled undone before it was sent
CREATE TABLE IF NOT EXISTS virga.defense_decision (
  id           BIGSERIAL PRIMARY KEY,
  owner_did    TEXT NOT NULL CHECK (char_length(owner_did) <= 512),
  list_id      UUID NOT NULL REFERENCES virga.defense_list(id) ON DELETE CASCADE,
  plan_id      UUID REFERENCES virga.defense_plan(id) ON DELETE SET NULL,
  job_id       UUID REFERENCES virga.defense_job(id) ON DELETE SET NULL,
  subject_did  TEXT NOT NULL CHECK (subject_did ~ '^did:[a-z]+:[a-zA-Z0-9._:%-]+$' AND char_length(subject_did) <= 512),
  action       TEXT NOT NULL CHECK (action IN ('add', 'remove')),
  band         TEXT CHECK (band IS NULL OR band IN ('CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN')),
  trust        SMALLINT CHECK (trust IS NULL OR trust BETWEEN 0 AND 100),
  via          TEXT NOT NULL CHECK (via IN ('web', 'dm', 'shield')),
  note         TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  state        TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sent', 'done', 'already', 'vetoed', 'failed', 'cancelled')),
  rkey         TEXT CHECK (rkey IS NULL OR rkey ~ '^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$'),
  reason       TEXT CHECK (reason IS NULL OR char_length(reason) <= 300),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at      TIMESTAMPTZ,
  acted_at     TIMESTAMPTZ,
  -- An add that a removal has taken back: when, and which removal.
  undone_at    TIMESTAMPTZ,
  undone_by    BIGINT REFERENCES virga.defense_decision(id) ON DELETE SET NULL,
  -- A removal's add.
  undoes       BIGINT REFERENCES virga.defense_decision(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_defense_decision_owner ON virga.defense_decision(owner_did, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_defense_decision_job ON virga.defense_decision(job_id, state);
CREATE INDEX IF NOT EXISTS idx_defense_decision_subject ON virga.defense_decision(list_id, subject_did);

ALTER TABLE virga.defense_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.defense_protected ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.defense_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.defense_plan_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.defense_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.defense_pace ENABLE ROW LEVEL SECURITY;
ALTER TABLE virga.defense_decision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE virga.defense_list, virga.defense_protected, virga.defense_plan, virga.defense_plan_row,
  virga.defense_job, virga.defense_pace, virga.defense_decision FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE virga.defense_list, virga.defense_protected, virga.defense_plan,
  virga.defense_plan_row, virga.defense_job, virga.defense_pace, virga.defense_decision TO service_role;
REVOKE ALL ON SEQUENCE virga.defense_decision_id_seq FROM anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE virga.defense_decision_id_seq TO service_role;

-- ─── A plan, stored ─────────────────────────────────────────────────────────
-- The plan's list must be the owner's own and still kept. A row naming a band
-- outside the four a plan may hold fails the table's check, so a plan naming
-- anyone PROTECTED is refused whole.
CREATE OR REPLACE FUNCTION virga.defense_create_plan(
  p_owner_did TEXT,
  p_list_id   UUID,
  p_post_uri  TEXT,
  p_rows      JSONB,
  p_totals    JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
DECLARE
  v_plan UUID;
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  PERFORM 1 FROM defense_list WHERE id = p_list_id AND owner_did = p_owner_did AND removed_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO defense_plan (owner_did, list_id, post_uri, totals)
    VALUES (p_owner_did, p_list_id, p_post_uri, COALESCE(p_totals, '{}'::jsonb))
    RETURNING id INTO v_plan;
  INSERT INTO defense_plan_row (plan_id, did, band, trust)
    SELECT v_plan, r->>'did', r->>'band', NULLIF(r->>'trust', '')::SMALLINT
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
    ON CONFLICT (plan_id, did) DO NOTHING;
  RETURN v_plan;
END;
$$;

-- ─── Approving a plan ───────────────────────────────────────────────────────
-- Queues an add for everyone in the plan whose band is approved, except those
-- kept by hand and those this list already has a live add for (queued, sent,
-- written or found there, and not undone). One job carries them. Returns the
-- job and how many were queued and left out; nothing for a plan that isn't
-- the owner's, has expired, or whose list is gone.
CREATE OR REPLACE FUNCTION virga.defense_approve_plan(
  p_owner_did TEXT,
  p_plan_id   UUID,
  p_bands     TEXT[],
  p_note      TEXT,
  p_via       TEXT DEFAULT 'web'
) RETURNS TABLE (job_id UUID, queued INTEGER, kept INTEGER, already INTEGER)
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_plan defense_plan%ROWTYPE;
  v_job UUID;
  v_queued INTEGER := 0;
  v_kept INTEGER := 0;
  v_already INTEGER := 0;
  v_bands TEXT[];
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  SELECT p.* INTO v_plan
    FROM defense_plan p JOIN defense_list l ON l.id = p.list_id
   WHERE p.id = p_plan_id AND p.owner_did = p_owner_did AND l.owner_did = p_owner_did
     AND l.removed_at IS NULL AND (p.expires_at IS NULL OR p.expires_at > NOW())
   FOR UPDATE OF p;
  IF NOT FOUND THEN RETURN; END IF;
  v_bands := ARRAY(SELECT b FROM unnest(COALESCE(p_bands, '{}')) AS b WHERE b IN ('CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN'));

  SELECT count(*) INTO v_kept
    FROM defense_plan_row r JOIN defense_protected k ON k.owner_did = p_owner_did AND k.did = r.did
   WHERE r.plan_id = p_plan_id AND r.band = ANY (v_bands);
  SELECT count(*) INTO v_already
    FROM defense_plan_row r
   WHERE r.plan_id = p_plan_id AND r.band = ANY (v_bands)
     AND NOT EXISTS (SELECT 1 FROM defense_protected k WHERE k.owner_did = p_owner_did AND k.did = r.did)
     AND EXISTS (SELECT 1 FROM defense_decision d
                  WHERE d.list_id = v_plan.list_id AND d.subject_did = r.did AND d.action = 'add'
                    AND d.state IN ('queued', 'sent', 'done', 'already') AND d.undone_at IS NULL);

  INSERT INTO defense_job (owner_did, list_id, kind) VALUES (p_owner_did, v_plan.list_id, 'add') RETURNING id INTO v_job;
  INSERT INTO defense_decision (owner_did, list_id, plan_id, job_id, subject_did, action, band, trust, via, note)
    SELECT p_owner_did, v_plan.list_id, p_plan_id, v_job, r.did, 'add', r.band, r.trust,
           CASE WHEN p_via IN ('web', 'dm', 'shield') THEN p_via ELSE 'web' END, p_note
      FROM defense_plan_row r
     WHERE r.plan_id = p_plan_id AND r.band = ANY (v_bands)
       AND NOT EXISTS (SELECT 1 FROM defense_protected k WHERE k.owner_did = p_owner_did AND k.did = r.did)
       AND NOT EXISTS (SELECT 1 FROM defense_decision d
                        WHERE d.list_id = v_plan.list_id AND d.subject_did = r.did AND d.action = 'add'
                          AND d.state IN ('queued', 'sent', 'done', 'already') AND d.undone_at IS NULL);
  GET DIAGNOSTICS v_queued = ROW_COUNT;
  IF v_queued = 0 THEN
    DELETE FROM defense_job WHERE id = v_job;
    v_job := NULL;
  END IF;

  UPDATE defense_plan
     SET approved_at = NOW(),
         approved_bands = ARRAY(SELECT DISTINCT b FROM unnest(approved_bands || v_bands) AS b ORDER BY b),
         note = COALESCE(p_note, note),
         -- Something will be written from it: it is kept for good.
         expires_at = CASE WHEN v_queued > 0 THEN NULL ELSE expires_at END
   WHERE id = p_plan_id;
  RETURN QUERY SELECT v_job, v_queued, v_kept, v_already;
END;
$$;

-- ─── Claiming work ──────────────────────────────────────────────────────────
-- Up to p_limit due jobs, at most one per holder, and only holders whose gap
-- has passed. Each claimed job's holder is paced p_gap_seconds from now, and
-- the job itself moves out of reach for the same time, so overlapping runs
-- never take the same job and a run that dies is retried at the next gap.
CREATE OR REPLACE FUNCTION virga.defense_claim_jobs(
  p_limit       INTEGER DEFAULT 10,
  p_gap_seconds INTEGER DEFAULT 120
) RETURNS TABLE (id UUID, owner_did TEXT, list_id UUID, kind TEXT, holder_did TEXT, list_uri TEXT, list_mode TEXT)
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  r RECORD;
  v_taken INTEGER := 0;
  v_holders TEXT[] := '{}';
BEGIN
  FOR r IN
    SELECT j.id AS job_id, j.owner_did AS job_owner, j.list_id AS job_list, j.kind AS job_kind,
           l.holder_did AS job_holder, l.uri AS job_uri, l.mode AS job_mode
      FROM defense_job j
      JOIN defense_list l ON l.id = j.list_id AND l.owner_did = j.owner_did
      LEFT JOIN defense_pace p ON p.holder_did = l.holder_did
     WHERE j.state = 'pending' AND j.next_at <= NOW() AND l.removed_at IS NULL
       AND (p.next_at IS NULL OR p.next_at <= NOW())
     ORDER BY j.next_at, j.created_at
       FOR UPDATE OF j SKIP LOCKED
  LOOP
    EXIT WHEN v_taken >= p_limit;
    CONTINUE WHEN r.job_holder = ANY (v_holders);
    v_holders := v_holders || r.job_holder;
    INSERT INTO defense_pace (holder_did, next_at) VALUES (r.job_holder, NOW() + make_interval(secs => p_gap_seconds))
      ON CONFLICT ON CONSTRAINT defense_pace_pkey DO UPDATE SET next_at = EXCLUDED.next_at;
    UPDATE defense_job SET locked_at = NOW(), next_at = NOW() + make_interval(secs => p_gap_seconds) WHERE defense_job.id = r.job_id;
    v_taken := v_taken + 1;
    id := r.job_id; owner_did := r.job_owner; list_id := r.job_list; kind := r.job_kind;
    holder_did := r.job_holder; list_uri := r.job_uri; list_mode := r.job_mode;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ─── Sending ────────────────────────────────────────────────────────────────
-- Marks decisions of one job as sent, under the record keys given (an add's
-- new key; a removal keeps its add's). Only the owner's, only that job's, and
-- only those queued or already sent (a resend keeps its first key). Returns
-- what was marked, which is what the run then writes.
CREATE OR REPLACE FUNCTION virga.defense_mark_sent(
  p_owner_did TEXT,
  p_job_id    UUID,
  p_ids       BIGINT[],
  p_rkeys     TEXT[]
) RETURNS SETOF virga.defense_decision
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  RETURN QUERY
  UPDATE defense_decision d
     SET state = 'sent',
         sent_at = COALESCE(d.sent_at, NOW()),
         rkey = COALESCE(d.rkey, k.rkey)
    FROM unnest(p_ids, p_rkeys) AS k(id, rkey)
   WHERE d.id = k.id AND d.owner_did = p_owner_did AND d.job_id = p_job_id
     AND d.state IN ('queued', 'sent')
  RETURNING d.*;
END;
$$;

-- ─── Settling ───────────────────────────────────────────────────────────────
-- Records what each write came to: p_results is [{ id, state, reason? }], with
-- state one of done, already, vetoed, failed, or queued (the PDS refused the
-- batch before writing anything, so it goes back to wait). A removal that is
-- done or already marks its add undone. A job with nothing left queued or sent
-- is done. Only the owner's sent decisions move.
CREATE OR REPLACE FUNCTION virga.defense_settle(
  p_owner_did TEXT,
  p_job_id    UUID,
  p_results   JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  WITH r AS (
    SELECT (x->>'id')::BIGINT AS id, x->>'state' AS state, left(x->>'reason', 300) AS reason
      FROM jsonb_array_elements(COALESCE(p_results, '[]'::jsonb)) AS x
     WHERE x->>'state' IN ('done', 'already', 'vetoed', 'failed', 'queued')
  ), moved AS (
    UPDATE defense_decision d
       SET state = r.state,
           reason = r.reason,
           acted_at = CASE WHEN r.state IN ('done', 'already') THEN NOW() ELSE d.acted_at END,
           sent_at = CASE WHEN r.state = 'queued' THEN NULL ELSE d.sent_at END
      FROM r
     WHERE d.id = r.id AND d.owner_did = p_owner_did AND d.job_id = p_job_id AND d.state = 'sent'
    RETURNING d.id, d.action, d.state, d.undoes
  ), undone AS (
    UPDATE defense_decision a
       SET undone_at = NOW(), undone_by = moved.id
      FROM moved
     WHERE moved.action = 'remove' AND moved.state IN ('done', 'already')
       AND a.id = moved.undoes AND a.owner_did = p_owner_did AND a.undone_at IS NULL
    RETURNING a.id
  )
  SELECT count(*) INTO v_count FROM moved;

  UPDATE defense_job j
     SET state = 'done', finished_at = NOW(), locked_at = NULL
   WHERE j.id = p_job_id AND j.owner_did = p_owner_did AND j.state = 'pending'
     AND NOT EXISTS (SELECT 1 FROM defense_decision d WHERE d.job_id = j.id AND d.state IN ('queued', 'sent'));
  RETURN v_count;
END;
$$;

-- A job held back: until a time (a rate limit, an account that can't be
-- written to right now), with why.
CREATE OR REPLACE FUNCTION virga.defense_hold_job(
  p_owner_did TEXT,
  p_job_id    UUID,
  p_until     TIMESTAMPTZ,
  p_error     TEXT
) RETURNS VOID
LANGUAGE sql
SET search_path = virga, pg_temp
AS $$
  UPDATE defense_job
     SET next_at = GREATEST(next_at, p_until), last_error = left(p_error, 500), locked_at = NULL
   WHERE id = p_job_id AND owner_did = p_owner_did AND state = 'pending';
$$;

-- ─── Undo ───────────────────────────────────────────────────────────────────
-- Takes back adds: every add of the owner's in p_ids (or in the plan p_plan_id)
-- that is still live. One not sent yet is cancelled; one sent or written gets
-- a removal under its own record key, queued in one remove job. Returns the
-- job and how many were cancelled and queued.
CREATE OR REPLACE FUNCTION virga.defense_undo(
  p_owner_did TEXT,
  p_plan_id   UUID,
  p_ids       BIGINT[],
  p_note      TEXT,
  p_via       TEXT DEFAULT 'web'
) RETURNS TABLE (job_id UUID, cancelled INTEGER, queued INTEGER)
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_cancelled INTEGER := 0;
  v_queued INTEGER := 0;
  v_job UUID;
  v_list UUID;
  r RECORD;
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  IF p_plan_id IS NULL AND (p_ids IS NULL OR cardinality(p_ids) = 0) THEN RETURN; END IF;

  -- Not sent yet: cancelled where it stands.
  WITH c AS (
    UPDATE defense_decision d
       SET state = 'cancelled', undone_at = NOW(), reason = 'undone before it was written'
     WHERE d.owner_did = p_owner_did AND d.action = 'add' AND d.state = 'queued' AND d.undone_at IS NULL
       AND ((p_plan_id IS NOT NULL AND d.plan_id = p_plan_id) OR d.id = ANY (COALESCE(p_ids, '{}')))
    RETURNING 1
  ) SELECT count(*) INTO v_cancelled FROM c;

  -- Sent or written, one remove job per list.
  FOR r IN
    SELECT d.id, d.list_id, d.subject_did, d.rkey
      FROM defense_decision d JOIN defense_list l ON l.id = d.list_id AND l.owner_did = p_owner_did
     WHERE d.owner_did = p_owner_did AND d.action = 'add' AND d.state IN ('sent', 'done') AND d.undone_at IS NULL
       AND d.rkey IS NOT NULL AND l.removed_at IS NULL
       AND ((p_plan_id IS NOT NULL AND d.plan_id = p_plan_id) OR d.id = ANY (COALESCE(p_ids, '{}')))
       AND NOT EXISTS (SELECT 1 FROM defense_decision x WHERE x.undoes = d.id AND x.state IN ('queued', 'sent'))
     ORDER BY d.list_id, d.id
  LOOP
    IF v_list IS DISTINCT FROM r.list_id THEN
      INSERT INTO defense_job (owner_did, list_id, kind) VALUES (p_owner_did, r.list_id, 'remove') RETURNING id INTO v_job;
      v_list := r.list_id;
    END IF;
    INSERT INTO defense_decision (owner_did, list_id, job_id, subject_did, action, via, note, rkey, undoes)
      VALUES (p_owner_did, r.list_id, v_job, r.subject_did, 'remove',
              CASE WHEN p_via IN ('web', 'dm', 'shield') THEN p_via ELSE 'web' END, p_note, r.rkey, r.id);
    v_queued := v_queued + 1;
  END LOOP;
  RETURN QUERY SELECT v_job, v_cancelled, v_queued;
END;
$$;

-- ─── Reading ────────────────────────────────────────────────────────────────
-- The owner's lists, with what is on each by Virga's hand and what is waiting.
CREATE OR REPLACE FUNCTION virga.defense_list_summary(
  p_owner_did TEXT
) RETURNS TABLE (
  id UUID, holder_did TEXT, mode TEXT, uri TEXT, name TEXT, purpose TEXT, created_at TIMESTAMPTZ,
  listed INTEGER, waiting INTEGER, held_until TIMESTAMPTZ, last_error TEXT
)
LANGUAGE sql
SET search_path = virga, pg_temp
AS $$
  SELECT l.id, l.holder_did, l.mode, l.uri, l.name, l.purpose, l.created_at,
         (SELECT count(*)::INTEGER FROM defense_decision d
           WHERE d.list_id = l.id AND d.action = 'add' AND d.state IN ('done', 'already') AND d.undone_at IS NULL),
         (SELECT count(*)::INTEGER FROM defense_decision d
           WHERE d.list_id = l.id AND d.state IN ('queued', 'sent')),
         (SELECT max(j.next_at) FROM defense_job j
           WHERE j.list_id = l.id AND j.state = 'pending' AND j.last_error IS NOT NULL AND j.next_at > NOW()),
         (SELECT j.last_error FROM defense_job j
           WHERE j.list_id = l.id AND j.state = 'pending' AND j.last_error IS NOT NULL ORDER BY j.next_at DESC LIMIT 1)
    FROM defense_list l
   WHERE l.owner_did = p_owner_did AND l.removed_at IS NULL
   ORDER BY l.created_at;
$$;

-- The owner's approved plans, newest first, each with what came of its adds.
-- Counted here rather than from a page of decisions, which an approval of
-- thousands outruns.
CREATE OR REPLACE FUNCTION virga.defense_plans(
  p_owner_did TEXT,
  p_limit     INTEGER DEFAULT 50
) RETURNS TABLE (
  id UUID, list_id UUID, post_uri TEXT, created_at TIMESTAMPTZ, approved_at TIMESTAMPTZ, approved_bands TEXT[],
  note TEXT, totals JSONB, added INTEGER, waiting INTEGER, kept INTEGER, failed INTEGER, undone INTEGER, live INTEGER
)
LANGUAGE sql
SET search_path = virga, pg_temp
AS $$
  SELECT p.id, p.list_id, p.post_uri, p.created_at, p.approved_at, p.approved_bands, p.note, p.totals,
         (count(d.id) FILTER (WHERE d.state IN ('done', 'already') AND d.undone_at IS NULL))::INTEGER,
         (count(d.id) FILTER (WHERE d.state IN ('queued', 'sent') AND d.undone_at IS NULL))::INTEGER,
         (count(d.id) FILTER (WHERE d.state = 'vetoed'))::INTEGER,
         (count(d.id) FILTER (WHERE d.state = 'failed'))::INTEGER,
         (count(d.id) FILTER (WHERE d.undone_at IS NOT NULL))::INTEGER,
         (count(d.id) FILTER (WHERE d.state IN ('queued', 'sent', 'done') AND d.undone_at IS NULL))::INTEGER
    FROM defense_plan p
    LEFT JOIN defense_decision d ON d.plan_id = p.id AND d.action = 'add' AND d.owner_did = p_owner_did
   WHERE p.owner_did = p_owner_did AND p.approved_at IS NOT NULL
   GROUP BY p.id
   ORDER BY p.approved_at DESC
   LIMIT GREATEST(1, LEAST(200, p_limit));
$$;

REVOKE ALL ON FUNCTION virga.defense_create_plan(TEXT, UUID, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_approve_plan(TEXT, UUID, TEXT[], TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_claim_jobs(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_mark_sent(TEXT, UUID, BIGINT[], TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_settle(TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_hold_job(TEXT, UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_undo(TEXT, UUID, BIGINT[], TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_list_summary(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION virga.defense_plans(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION virga.defense_create_plan(TEXT, UUID, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_approve_plan(TEXT, UUID, TEXT[], TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_claim_jobs(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_mark_sent(TEXT, UUID, BIGINT[], TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_settle(TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_hold_job(TEXT, UUID, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_undo(TEXT, UUID, BIGINT[], TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_list_summary(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION virga.defense_plans(TEXT, INTEGER) TO service_role;
