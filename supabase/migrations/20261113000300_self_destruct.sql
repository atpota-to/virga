-- Post timers (server/timers/selfDestruct.js): a published post to delete, or
-- to gate, on its author's PDS once its lifespan runs out, unless its
-- conditions spare it. The cron worker claims due rows here; nothing lives in
-- the author's repo. Only the service role (which bypasses RLS) touches any of
-- it. Safe to re-apply.

CREATE TABLE IF NOT EXISTS self_destruct_posts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_did         TEXT        NOT NULL,
  post_uri         TEXT        NOT NULL,
  post_cid         TEXT,
  collection       TEXT        NOT NULL DEFAULT 'app.bsky.feed.post',
  rkey             TEXT        NOT NULL,
  -- The rest of a thread, deleted with its root: [{ uri, collection, rkey }].
  extra_uris       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  snippet          TEXT,
  -- When the timer was armed. The deadline itself is check_at.
  posted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_at         TIMESTAMPTZ NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'armed'
                   CHECK (status IN ('armed', 'checking', 'deleted', 'acted', 'spared', 'failed', 'cancelled')),
  conditions       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- NULL means delete; otherwise the normalized effect list.
  effects          JSONB,
  -- Settled: [{ action, ok, detail }]. In flight: { pending: true, counts, reason, ... },
  -- the verdict pinned before any effect runs, so a retry resumes it.
  acted            JSONB,
  lifespan_seconds INTEGER     NOT NULL,
  extensions       INTEGER     NOT NULL DEFAULT 0,
  last_counts      JSONB,
  resolution       TEXT,
  resolved_at      TIMESTAMPTZ,
  attempts         INTEGER     NOT NULL DEFAULT 0,
  max_attempts     INTEGER     NOT NULL DEFAULT 5,
  next_attempt_at  TIMESTAMPTZ,
  last_error       TEXT,
  -- SESSION_UNAVAILABLE | ENGAGEMENT_UNAVAILABLE | TIMED_OUT | RATE_LIMITED | REFUSED | UNKNOWN
  last_error_code  TEXT,
  locked_at        TIMESTAMPTZ,
  locked_by        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE self_destruct_posts IS
  'Post timers: a published post to delete (or gate) on its author''s PDS once its lifespan runs out, unless its conditions spare it. Service role only.';
COMMENT ON COLUMN self_destruct_posts.status IS
  'armed | checking | deleted | acted | spared | failed | cancelled. acted = the rule fired without deleting. A failed timer leaves the post up.';
COMMENT ON COLUMN self_destruct_posts.lifespan_seconds IS
  'The window the author chose, as the composer sent it. An extend spare gives the post this same window again; never re-derived from check_at.';

-- The worker's due read: live timers only.
CREATE INDEX IF NOT EXISTS self_destruct_due_idx
  ON self_destruct_posts (check_at)
  WHERE status = 'armed';

-- The timers page and the per-account counts.
CREATE INDEX IF NOT EXISTS self_destruct_user_idx
  ON self_destruct_posts (user_did, check_at)
  WHERE status IN ('armed', 'checking', 'failed', 'acted');

-- One live timer per post: a retried create hands back the same row.
CREATE UNIQUE INDEX IF NOT EXISTS self_destruct_live_post_idx
  ON self_destruct_posts (user_did, post_uri)
  WHERE status IN ('armed', 'checking');

-- Claim due timers for one worker run. FOR UPDATE SKIP LOCKED in the same
-- statement as the flip to 'checking', so overlapping runs never get the same
-- row. Each claim spends an attempt.
CREATE OR REPLACE FUNCTION claim_self_destruct_posts(
  p_run_id TEXT,
  p_limit  INTEGER DEFAULT 25
) RETURNS SETOF self_destruct_posts
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
      FROM self_destruct_posts
     WHERE status = 'armed'
       AND check_at <= NOW()
       AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
     ORDER BY check_at
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE self_destruct_posts s
     SET status     = 'checking',
         locked_at  = NOW(),
         locked_by  = p_run_id,
         attempts   = s.attempts + 1,
         updated_at = NOW()
    FROM due
   WHERE s.id = due.id
  RETURNING s.*;
END;
$$;

-- Hand back rows a dead worker left in 'checking'. Older than the function's
-- maxDuration, so never a live worker's row. A row past its attempts is retired
-- with the post still up; the sentence matches the worker's TIMED_OUT_ERROR.
CREATE OR REPLACE FUNCTION reclaim_stuck_self_destructs(
  p_older_than_seconds INTEGER DEFAULT 180
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH reclaimed AS (
    UPDATE self_destruct_posts
       SET status          = CASE WHEN attempts > max_attempts THEN 'failed' ELSE 'armed' END,
           last_error      = CASE WHEN attempts > max_attempts
                                  THEN COALESCE(last_error, 'the timer ran out of time before this post could be checked.')
                                  ELSE last_error END,
           last_error_code = CASE WHEN attempts > max_attempts
                                  THEN COALESCE(last_error_code, 'TIMED_OUT')
                                  ELSE last_error_code END,
           resolution      = CASE WHEN attempts > max_attempts
                                  THEN COALESCE(resolution, 'the post is still up')
                                  ELSE resolution END,
           resolved_at     = CASE WHEN attempts > max_attempts THEN NOW() ELSE resolved_at END,
           locked_at       = NULL,
           locked_by       = NULL,
           updated_at      = NOW()
     WHERE status = 'checking'
       AND locked_at < NOW() - make_interval(secs => p_older_than_seconds)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM reclaimed;
  RETURN v_count;
END;
$$;

-- Arm one timer. A per-account advisory lock makes the count-then-insert
-- ceiling exact; the partial unique index above is the hard guarantee of one
-- live timer per post. Arming a post that already has one hands that row back
-- with existing = true (the caller rewrites an armed one to the new rule).
-- Returns { ok, row, existing? } or { ok: false, code: 'QUOTA_EXCEEDED', limit, count }.
CREATE OR REPLACE FUNCTION create_self_destruct_capped(
  p_user_did         TEXT,
  p_post_uri         TEXT,
  p_post_cid         TEXT,
  p_collection       TEXT,
  p_rkey             TEXT,
  p_snippet          TEXT,
  p_extra_uris       JSONB,
  p_check_at         TIMESTAMPTZ,
  p_lifespan_seconds INTEGER,
  p_conditions       JSONB   DEFAULT '{}'::jsonb,
  p_max_active       INTEGER DEFAULT 200,
  p_effects          JSONB   DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER := GREATEST(COALESCE(p_max_active, 200), 0);
  v_count INTEGER;
  v_row   JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('self_destruct_posts:' || p_user_did)::BIGINT);

  SELECT to_jsonb(s.*) INTO v_row
    FROM self_destruct_posts s
   WHERE s.user_did = p_user_did
     AND s.post_uri = p_post_uri
     AND s.status IN ('armed', 'checking')
   LIMIT 1;
  IF v_row IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'row', v_row, 'existing', true);
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM self_destruct_posts
   WHERE user_did = p_user_did
     AND status IN ('armed', 'checking');

  IF v_count >= v_limit THEN
    RETURN jsonb_build_object('ok', false, 'code', 'QUOTA_EXCEEDED', 'limit', v_limit, 'count', v_count);
  END IF;

  INSERT INTO self_destruct_posts (
    user_did, post_uri, post_cid, collection, rkey, snippet, extra_uris,
    check_at, lifespan_seconds, conditions, effects, status
  ) VALUES (
    p_user_did, p_post_uri, p_post_cid,
    COALESCE(p_collection, 'app.bsky.feed.post'), p_rkey, p_snippet,
    CASE WHEN jsonb_typeof(p_extra_uris) = 'array' THEN p_extra_uris ELSE '[]'::jsonb END,
    p_check_at, GREATEST(COALESCE(p_lifespan_seconds, 0), 0),
    COALESCE(p_conditions, '{}'::jsonb),
    CASE WHEN jsonb_typeof(p_effects) = 'array' THEN p_effects ELSE NULL END,
    'armed'
  )
  RETURNING to_jsonb(self_destruct_posts.*) INTO v_row;

  RETURN jsonb_build_object('ok', true, 'row', v_row, 'existing', false);
END;
$$;

ALTER TABLE self_destruct_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE self_destruct_posts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE self_destruct_posts TO service_role;

REVOKE ALL ON FUNCTION claim_self_destruct_posts(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reclaim_stuck_self_destructs(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_self_destruct_capped(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, INTEGER, JSONB, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_self_destruct_posts(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION reclaim_stuck_self_destructs(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION create_self_destruct_capped(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, INTEGER, JSONB, INTEGER, JSONB)
  TO service_role;
