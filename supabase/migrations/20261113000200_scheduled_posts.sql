-- Scheduled posts (server/schedule/*): a row per post or thread waiting to be
-- written to the account's PDS by the cron worker (/api/schedule/run). The
-- post lives here, not on the PDS, because the worker needs a cheap indexed
-- "what is due?" read and owns queue state (status, attempts, locks) that
-- doesn't belong in anyone's repo. Only the service role (which bypasses RLS)
-- touches any of it. Safe to re-apply.
--
-- gen_random_uuid() is built into Postgres 13+, so no extension is created.

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_did           TEXT        NOT NULL,           -- whose PDS the post goes to
  scheduled_for      TIMESTAMPTZ NOT NULL,           -- when to publish (UTC)
  status             TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'cancelled')),
  -- { posts, gates, media, rkeys, tz?, selfDestruct }: see server/schedule/scheduledPosts.js.
  payload            JSONB       NOT NULL,
  target             TEXT        NOT NULL DEFAULT 'bluesky' CHECK (target = 'bluesky'),
  queued             BOOLEAN     NOT NULL DEFAULT false,
  -- [{ uri, cid }] of the thread's posts already written, so a retry resumes
  -- instead of writing them twice. Empty for a post not yet started.
  progress           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  result_uri         TEXT,                           -- the root's at:// URI once published
  result_cid         TEXT,
  attempts           INT         NOT NULL DEFAULT 0, -- incremented by each claim
  max_attempts       INT         NOT NULL DEFAULT 5,
  next_attempt_at    TIMESTAMPTZ,                    -- backoff after a failed attempt
  last_error         TEXT,                           -- a sentence for the reader
  -- The machine-readable reason beside last_error. A closed vocabulary kept by
  -- FAILURE_CODES in JS, deliberately without a CHECK so the list can grow
  -- without a migration: SESSION_UNAVAILABLE, MEDIA_MISSING, TIMED_OUT,
  -- RATE_LIMITED, REFUSED, TIMER_NOT_ARMED (rides on a published row), UNKNOWN.
  last_error_code    TEXT,
  media_reclaimed_at TIMESTAMPTZ,                    -- a failed row's stashed images were swept
  locked_at          TIMESTAMPTZ,                    -- set by the claim; powers the stuck-row reclaim
  locked_by          TEXT,                           -- the claiming run's id
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN scheduled_posts.queued IS
  'true: a queue row, published at the next free posting slot; false: a one-off post pinned to scheduled_for.';

-- The worker's "what is due?" read stays cheap as the table grows.
CREATE INDEX IF NOT EXISTS scheduled_posts_due_idx
  ON scheduled_posts (scheduled_for)
  WHERE status = 'pending';

-- The account's list, its counts and the rkey reservation all read every
-- status of one DID's rows.
CREATE INDEX IF NOT EXISTS scheduled_posts_user_idx
  ON scheduled_posts (user_did, scheduled_for);

-- The failed-media sweep.
CREATE INDEX IF NOT EXISTS scheduled_posts_media_reclaim_idx
  ON scheduled_posts (updated_at)
  WHERE status = 'failed' AND media_reclaimed_at IS NULL;

-- No policies: every role but the service role is refused.
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE scheduled_posts FROM anon, authenticated;

-- ─── Claim ──────────────────────────────────────────────────────────────────
-- Flip a batch of due rows to 'publishing' in one statement. FOR UPDATE SKIP
-- LOCKED means two overlapping cron runs never claim the same row, so nothing
-- is published twice and nobody waits on a slow PDS. Each claim counts as an
-- attempt.
CREATE OR REPLACE FUNCTION claim_scheduled_posts(
  p_run_id TEXT,
  p_limit  INTEGER DEFAULT 20
) RETURNS SETOF scheduled_posts
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
      FROM scheduled_posts
     WHERE status = 'pending'
       AND scheduled_for <= NOW()
       AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
     ORDER BY scheduled_for
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE scheduled_posts s
     SET status     = 'publishing',
         locked_at  = NOW(),
         locked_by  = p_run_id,
         attempts   = s.attempts + 1,
         updated_at = NOW()
    FROM due
   WHERE s.id = due.id
  RETURNING s.*;
END;
$$;

-- ─── Stuck-row reclaim ──────────────────────────────────────────────────────
-- A row left 'publishing' past p_older_than_seconds belongs to a run that
-- died mid-write. It goes back to 'pending' for the next claim, or, once it is
-- past its attempt budget, to 'failed' with the sentence the worker writes for
-- the same case, so it can't cycle pending -> publishing -> stuck forever.
CREATE OR REPLACE FUNCTION reclaim_stuck_scheduled_posts(
  p_older_than_seconds INTEGER DEFAULT 600
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH reclaimed AS (
    UPDATE scheduled_posts
       SET status          = CASE WHEN attempts > max_attempts THEN 'failed' ELSE 'pending' END,
           last_error      = CASE WHEN attempts > max_attempts
                                  THEN COALESCE(last_error, 'the publisher ran out of time before this post could be written.')
                                  ELSE last_error END,
           last_error_code = CASE WHEN attempts > max_attempts
                                  THEN COALESCE(last_error_code, 'TIMED_OUT')
                                  ELSE last_error_code END,
           locked_at       = NULL,
           locked_by       = NULL,
           updated_at      = NOW()
     WHERE status = 'publishing'
       AND locked_at < NOW() - make_interval(secs => p_older_than_seconds)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM reclaimed;
  RETURN v_count;
END;
$$;

-- ─── Failed-media sweep ─────────────────────────────────────────────────────
-- Failed rows nobody came back to within p_older_than_days whose stashed
-- images are still in Storage. Read-only: the worker deletes the objects and
-- only then stamps media_reclaimed_at, so a failed delete is retried later.
CREATE OR REPLACE FUNCTION reclaim_failed_scheduled_media(
  p_older_than_days INTEGER DEFAULT 30
) RETURNS TABLE (id UUID, payload JSONB)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.payload
    FROM scheduled_posts s
   WHERE s.status = 'failed'
     AND s.media_reclaimed_at IS NULL
     AND s.updated_at < NOW() - make_interval(days => GREATEST(COALESCE(p_older_than_days, 30), 1))
     AND jsonb_typeof(s.payload -> 'media') = 'object'
     AND s.payload -> 'media' <> '{}'::jsonb
   ORDER BY s.updated_at
   LIMIT 100;
$$;

-- ─── Queue reorder ──────────────────────────────────────────────────────────
-- Apply a whole permutation of one account's pending queue, or none of it.
-- p_moves is [{ "id": uuid, "scheduledFor": iso, "rkeys": [...]? }], 1 to 50
-- of them. Record keys are TIDs minted from the scheduled time in JS, so the
-- caller passes the re-minted keys; this only merges them into the payload.
-- The named rows are locked before eligibility is checked (the claim's SKIP
-- LOCKED then passes them by), and a row count that disagrees rolls the whole
-- move back. Refusals come back as data, never as an error.
CREATE OR REPLACE FUNCTION reorder_scheduled_posts(
  p_user_did TEXT,
  p_moves    JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count    INTEGER;
  v_distinct INTEGER;
  v_times    INTEGER;
  v_ok       INTEGER;
  v_moved    INTEGER;
BEGIN
  IF p_user_did IS NULL OR p_user_did = '' OR p_moves IS NULL OR jsonb_typeof(p_moves) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST', 'error', 'the reorder did not arrive in a shape we could read.');
  END IF;

  v_count := jsonb_array_length(p_moves);
  IF v_count = 0 OR v_count > 50 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST', 'error', 'a reorder carries between one and fifty posts.');
  END IF;

  BEGIN
    SELECT COUNT(DISTINCT (e->>'id')::uuid),
           COUNT(*) FILTER (WHERE (e->>'scheduledFor')::timestamptz IS NOT NULL)
      INTO v_distinct, v_times
      FROM jsonb_array_elements(p_moves) e;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST', 'error', 'a post id or time in that reorder could not be read.');
  END;

  IF v_times <> v_count THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST', 'error', 'a post in that reorder has no new time.');
  END IF;

  IF v_distinct <> v_count THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST', 'error', 'a post appears twice in that reorder.');
  END IF;

  PERFORM 1
     FROM scheduled_posts s
    WHERE s.user_did = p_user_did
      AND s.id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_moves) e)
      FOR UPDATE;

  SELECT COUNT(*) INTO v_ok
    FROM scheduled_posts s
   WHERE s.user_did = p_user_did
     AND s.id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_moves) e)
     AND s.status = 'pending'
     AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(s.progress) = 'array' THEN s.progress END), 0) = 0;

  IF v_ok <> v_count THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_REORDERABLE');
  END IF;

  WITH m AS (
    SELECT (e->>'id')::uuid                  AS id,
           (e->>'scheduledFor')::timestamptz AS scheduled_for,
           CASE WHEN jsonb_typeof(e->'rkeys') = 'array' THEN e->'rkeys' END AS rkeys
      FROM jsonb_array_elements(p_moves) e
  )
  UPDATE scheduled_posts s
     SET scheduled_for   = m.scheduled_for,
         next_attempt_at = NULL,
         payload         = CASE WHEN m.rkeys IS NULL THEN s.payload
                                ELSE COALESCE(s.payload, '{}'::jsonb) || jsonb_build_object('rkeys', m.rkeys) END,
         updated_at      = NOW()
    FROM m
   WHERE s.id = m.id
     AND s.user_did = p_user_did
     AND s.status = 'pending';

  GET DIAGNOSTICS v_moved = ROW_COUNT;

  IF v_moved <> v_count THEN
    RAISE EXCEPTION 'reorder_scheduled_posts: % of % rows moved', v_moved, v_count
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN jsonb_build_object('ok', true, 'moved', v_moved);
EXCEPTION WHEN serialization_failure THEN
  RETURN jsonb_build_object('ok', false, 'code', 'NOT_REORDERABLE');
END;
$$;

-- ─── Capped create ──────────────────────────────────────────────────────────
-- Count the account's pending and publishing rows and insert under one
-- per-DID advisory lock, so parallel creates can't each read a count under
-- the cap. p_max_active is the ceiling the server applies (the lower of its
-- flat cap and any configured feature limit). Answers { ok: true, post } or
-- { ok: false, code: 'QUOTA_EXCEEDED', limit, count }.
CREATE OR REPLACE FUNCTION create_scheduled_post_capped(
  p_user_did      TEXT,
  p_scheduled_for TIMESTAMPTZ,
  p_target        TEXT,
  p_payload       JSONB,
  p_queued        BOOLEAN DEFAULT false,
  p_max_active    INTEGER DEFAULT 50
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER := GREATEST(COALESCE(p_max_active, 50), 0);
  v_count INTEGER;
  v_row   JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('scheduled_posts:' || p_user_did)::BIGINT);

  SELECT COUNT(*) INTO v_count
    FROM scheduled_posts
   WHERE user_did = p_user_did
     AND status IN ('pending', 'publishing');

  IF v_count >= v_limit THEN
    RETURN jsonb_build_object('ok', false, 'code', 'QUOTA_EXCEEDED', 'limit', v_limit, 'count', v_count);
  END IF;

  INSERT INTO scheduled_posts (user_did, scheduled_for, target, payload, queued, status)
  VALUES (p_user_did, p_scheduled_for, COALESCE(p_target, 'bluesky'), p_payload, COALESCE(p_queued, false), 'pending')
  RETURNING to_jsonb(scheduled_posts.*) INTO v_row;

  RETURN jsonb_build_object('ok', true, 'post', v_row);
END;
$$;

-- Postgres grants EXECUTE to PUBLIC, and Supabase to anon and authenticated,
-- on every new function; any of these would then be callable through
-- PostgREST with the public anon key.
REVOKE ALL ON FUNCTION claim_scheduled_posts(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reclaim_stuck_scheduled_posts(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reclaim_failed_scheduled_media(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reorder_scheduled_posts(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_scheduled_post_capped(TEXT, TIMESTAMPTZ, TEXT, JSONB, BOOLEAN, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_scheduled_posts(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION reclaim_stuck_scheduled_posts(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION reclaim_failed_scheduled_media(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION reorder_scheduled_posts(TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION create_scheduled_post_capped(TEXT, TIMESTAMPTZ, TEXT, JSONB, BOOLEAN, INTEGER) TO service_role;

-- ─── Storage bucket for stashed images ──────────────────────────────────────
-- Image and card-thumbnail bytes wait here between scheduling and publishing
-- (the PDS garbage-collects a blob nothing references, so blobs are uploaded
-- only at publish time). Private: only the service role reads it. Guarded so
-- the file also applies to a plain Postgres without Supabase's storage schema.
DO $do$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'no storage.buckets table; the scheduled-media bucket was not created';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('scheduled-media', 'scheduled-media', false, 10485760)  -- 10 MB per object
  ON CONFLICT (id) DO NOTHING;
END
$do$;
