-- Defense, phase 3: fixes from the phase-boundary review (docs/DEFENSE.md,
-- "Phase 3, reviewed"). Each replaces a function from 20261118000100.
--
--   defense_mark_sent    never sends an add that has been taken back
--   defense_settle       may settle a decision still queued (one the veto
--                        refused before anything was sent, or one with a key
--                        found written) and takes 'cancelled', for an add
--                        undone before it landed
--   defense_claim_jobs   holds a lock per holder while it checks the pace, so
--                        two overlapping claims can't each take one of the
--                        same holder's jobs inside the gap
--   defense_approve_plan holds a lock per list, so two approvals at once
--                        can't both queue the same person
--   defense_hold_holder  new: a rate limit holds the holder, not just the job

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
     AND d.state IN ('queued', 'sent') AND d.undone_at IS NULL
     -- An add whose removal is waiting is only ever read, never sent again.
     AND NOT (d.action = 'add' AND EXISTS (
           SELECT 1 FROM defense_decision x WHERE x.undoes = d.id AND x.owner_did = p_owner_did AND x.state IN ('queued', 'sent')))
  RETURNING d.*;
END;
$$;

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
     WHERE x->>'state' IN ('done', 'already', 'vetoed', 'failed', 'queued', 'cancelled')
  ), moved AS (
    UPDATE defense_decision d
       SET state = r.state,
           reason = r.reason,
           acted_at = CASE WHEN r.state IN ('done', 'already') THEN NOW() ELSE d.acted_at END,
           sent_at = CASE WHEN r.state = 'queued' THEN NULL ELSE d.sent_at END,
           undone_at = CASE WHEN r.state = 'cancelled' THEN COALESCE(d.undone_at, NOW()) ELSE d.undone_at END
      FROM r
     WHERE d.id = r.id AND d.owner_did = p_owner_did AND d.job_id = p_job_id AND d.state IN ('queued', 'sent')
       -- Only something sent, under a key, may be found written.
       AND (d.state = 'sent' OR d.rkey IS NOT NULL OR r.state NOT IN ('done', 'already'))
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
    -- One claim at a time per holder, and the pace read again under the
    -- lock: the row read above may be one another claim has just moved on.
    CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtext('virga.defense_pace'), hashtext(r.job_holder));
    CONTINUE WHEN EXISTS (SELECT 1 FROM defense_pace p WHERE p.holder_did = r.job_holder AND p.next_at > NOW());
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
  -- Approvals for one list, one at a time: "already on it" is read and acted
  -- on under the lock, so two at once can't both add the same person.
  PERFORM pg_advisory_xact_lock(hashtext('virga.defense_list'), hashtext(v_plan.list_id::text));
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
         expires_at = CASE WHEN v_queued > 0 THEN NULL ELSE expires_at END
   WHERE id = p_plan_id;
  RETURN QUERY SELECT v_job, v_queued, v_kept, v_already;
END;
$$;

-- A rate limit is the holder's, whichever of its lists hit it: every job for
-- that holder waits, not only the one that met it.
CREATE OR REPLACE FUNCTION virga.defense_hold_holder(
  p_owner_did TEXT,
  p_job_id    UUID,
  p_until     TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = virga, pg_temp
AS $$
DECLARE
  v_holder TEXT;
BEGIN
  IF p_owner_did IS NULL THEN RAISE EXCEPTION 'an owner is required'; END IF;
  SELECT l.holder_did INTO v_holder
    FROM defense_job j JOIN defense_list l ON l.id = j.list_id AND l.owner_did = j.owner_did
   WHERE j.id = p_job_id AND j.owner_did = p_owner_did;
  IF v_holder IS NULL THEN RETURN; END IF;
  INSERT INTO defense_pace (holder_did, next_at) VALUES (v_holder, p_until)
    ON CONFLICT ON CONSTRAINT defense_pace_pkey DO UPDATE SET next_at = GREATEST(defense_pace.next_at, EXCLUDED.next_at);
END;
$$;

REVOKE ALL ON FUNCTION virga.defense_hold_holder(TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION virga.defense_hold_holder(TEXT, UUID, TIMESTAMPTZ) TO service_role;
