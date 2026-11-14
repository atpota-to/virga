-- Repeating scheduled posts (server/schedule/recurrence.js): a post that goes
-- out every day, week, two weeks or month is a series of scheduled_posts
-- rows, one per occurrence, of which only one waits at a time. When an
-- occurrence is settled (it published, it failed for good, or it was
-- skipped), the next one is written in the same transaction, so a crash can
-- never leave a series with nothing waiting, and a second run can never
-- write a second copy. Scheduled replies need no schema: their refs ride in
-- the payload. Only the service role touches any of it. Safe to re-apply.

-- Every occurrence of one repeating post shares series_id; occurrence is its
-- number in the series, from 1. A post that never repeated has neither. The
-- rule itself (payload.repeat) sits only on the row that carries the series
-- forward: the one waiting, or the last one once the series is over.
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS series_id  UUID;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS occurrence INTEGER;

COMMENT ON COLUMN scheduled_posts.series_id IS
  'Set on every occurrence of a repeating post; null for a post that never repeated.';
COMMENT ON COLUMN scheduled_posts.occurrence IS
  'This row''s number in its series, from 1; missed and skipped slots are counted.';

ALTER TABLE scheduled_posts DROP CONSTRAINT IF EXISTS scheduled_posts_series_shape;
ALTER TABLE scheduled_posts ADD CONSTRAINT scheduled_posts_series_shape
  CHECK ((series_id IS NULL) = (occurrence IS NULL) AND (occurrence IS NULL OR occurrence >= 1));

-- One row per occurrence of a series. This is what makes writing the next
-- occurrence idempotent: whoever tries second finds the number taken. It
-- also serves "the other rows of this series" (the media release reads them).
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_posts_series_occurrence_idx
  ON scheduled_posts (series_id, occurrence)
  WHERE series_id IS NOT NULL;

-- ─── Capped create, with a series ───────────────────────────────────────────
-- The capped create from the scheduled-posts migration, taking the series a
-- repeating post starts (p_series_id, p_occurrence). The six-argument form is
-- dropped so there is one function of this name; the server always passes
-- every argument, so a re-applied earlier migration that brings the old form
-- back cannot be called by mistake.
DROP FUNCTION IF EXISTS create_scheduled_post_capped(TEXT, TIMESTAMPTZ, TEXT, JSONB, BOOLEAN, INTEGER);

CREATE OR REPLACE FUNCTION create_scheduled_post_capped(
  p_user_did      TEXT,
  p_scheduled_for TIMESTAMPTZ,
  p_target        TEXT,
  p_payload       JSONB,
  p_queued        BOOLEAN DEFAULT false,
  p_max_active    INTEGER DEFAULT 50,
  p_series_id     UUID    DEFAULT NULL,
  p_occurrence    INTEGER DEFAULT NULL
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

  INSERT INTO scheduled_posts (user_did, scheduled_for, target, payload, queued, status, series_id, occurrence)
  VALUES (p_user_did, p_scheduled_for, COALESCE(p_target, 'bluesky'), p_payload, COALESCE(p_queued, false), 'pending',
          p_series_id, CASE WHEN p_series_id IS NULL THEN NULL ELSE COALESCE(p_occurrence, 1) END)
  RETURNING to_jsonb(scheduled_posts.*) INTO v_row;

  RETURN jsonb_build_object('ok', true, 'post', v_row);
END;
$$;

-- ─── Settle an occurrence ───────────────────────────────────────────────────
-- Record how a row ended and, if it carries a series, write the occurrence
-- that follows, in one transaction.
--
--   p_status  'published' | 'failed' | 'cancelled' (cancelled is a skip)
--   p_fields  the bookkeeping to write with it: any of result_uri,
--             result_cid, last_error, last_error_code; a key that is absent
--             leaves the column alone, a null clears it
--   p_next    { "scheduledFor": iso, "occurrence": n, "payload": { ... } } or
--             null. The time and the record keys are worked out in JS (the
--             wall-clock arithmetic and TID minting live there); `payload` is
--             laid over the settled row's, so the next occurrence is the same
--             post with new keys.
--   p_user_did, p_only_pending
--             a skip asked for through the API: the row must be this
--             account's and still waiting with nothing written. The worker
--             passes neither: it settles a row whatever a reclaim did to it
--             meanwhile, because the post is out (or isn't) either way.
--
-- The next occurrence is written only when the settled row still carries the
-- rule (payload.repeat) and p_next is given. The rule moves with it: it is
-- taken off the settled row and rides on the new one, so a row settled twice
-- (two overlapping runs, a retry of an old failure) finds nothing left to
-- carry forward. Under that, the unique index on (series_id, occurrence)
-- makes the insert itself a no-op the second time. The row is locked first,
-- so two settles of one row run one after the other.
--
-- Nothing is counted against the account's cap: the settled row leaves the
-- waiting set in the same transaction as its successor joins it.
--
-- Answers { ok: true, next: <the new row or null> }, or { ok: false, code }
-- with NOT_FOUND, NOT_PENDING or BAD_REQUEST. A p_next that can't be read
-- raises, which rolls the status change back with it.
CREATE OR REPLACE FUNCTION settle_scheduled_occurrence(
  p_id           UUID,
  p_status       TEXT,
  p_fields       JSONB   DEFAULT '{}'::jsonb,
  p_next         JSONB   DEFAULT NULL,
  p_user_did     TEXT    DEFAULT NULL,
  p_only_pending BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row    scheduled_posts%ROWTYPE;
  v_fields JSONB := COALESCE(p_fields, '{}'::jsonb);
  v_spawn  BOOLEAN;
  v_next   JSONB;
BEGIN
  IF p_id IS NULL OR p_status IS NULL OR p_status NOT IN ('published', 'failed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  END IF;

  SELECT * INTO v_row
    FROM scheduled_posts
   WHERE id = p_id
     AND (p_user_did IS NULL OR user_did = p_user_did)
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  IF COALESCE(p_only_pending, false)
     AND (v_row.status <> 'pending'
          OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(v_row.progress) = 'array' THEN v_row.progress END), 0) > 0) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_PENDING', 'status', v_row.status);
  END IF;

  v_spawn := p_next IS NOT NULL
         AND jsonb_typeof(p_next) = 'object'
         AND v_row.series_id IS NOT NULL
         AND v_row.payload ? 'repeat';

  UPDATE scheduled_posts
     SET status          = p_status,
         result_uri      = CASE WHEN v_fields ? 'result_uri' THEN v_fields->>'result_uri' ELSE result_uri END,
         result_cid      = CASE WHEN v_fields ? 'result_cid' THEN v_fields->>'result_cid' ELSE result_cid END,
         last_error      = CASE WHEN v_fields ? 'last_error' THEN v_fields->>'last_error' ELSE last_error END,
         last_error_code = CASE WHEN v_fields ? 'last_error_code' THEN v_fields->>'last_error_code' ELSE last_error_code END,
         payload         = CASE WHEN v_spawn THEN payload - 'repeat' ELSE payload END,
         locked_at       = NULL,
         locked_by       = NULL,
         updated_at      = NOW()
   WHERE id = p_id;

  IF v_spawn THEN
    INSERT INTO scheduled_posts (user_did, scheduled_for, target, payload, queued, status, series_id, occurrence)
    VALUES (v_row.user_did,
            (p_next->>'scheduledFor')::timestamptz,
            v_row.target,
            v_row.payload || COALESCE(CASE WHEN jsonb_typeof(p_next->'payload') = 'object' THEN p_next->'payload' END, '{}'::jsonb),
            false,
            'pending',
            v_row.series_id,
            (p_next->>'occurrence')::integer)
    ON CONFLICT (series_id, occurrence) WHERE series_id IS NOT NULL DO NOTHING
    RETURNING to_jsonb(scheduled_posts.*) INTO v_next;
  END IF;

  RETURN jsonb_build_object('ok', true, 'next', v_next);
END;
$$;

-- ─── Stop repeating ─────────────────────────────────────────────────────────
-- Take the rule off the waiting (or failed) row that carries it. The row
-- stays as it is and goes out at its time; nothing follows it. One statement,
-- so it can't cross with a claim or an edit. Answers the row, or null when
-- there was nothing of the account's to stop.
CREATE OR REPLACE FUNCTION stop_scheduled_repeat(
  p_id       UUID,
  p_user_did TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row JSONB;
BEGIN
  UPDATE scheduled_posts
     SET payload    = payload - 'repeat',
         updated_at = NOW()
   WHERE id = p_id
     AND user_did = p_user_did
     AND status IN ('pending', 'failed')
     AND payload ? 'repeat'
  RETURNING to_jsonb(scheduled_posts.*) INTO v_row;
  RETURN v_row;
END;
$$;

-- As in the scheduled-posts migration: nothing here may be callable through
-- PostgREST with the public anon key.
REVOKE ALL ON FUNCTION create_scheduled_post_capped(TEXT, TIMESTAMPTZ, TEXT, JSONB, BOOLEAN, INTEGER, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION settle_scheduled_occurrence(UUID, TEXT, JSONB, JSONB, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stop_scheduled_repeat(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_scheduled_post_capped(TEXT, TIMESTAMPTZ, TEXT, JSONB, BOOLEAN, INTEGER, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION settle_scheduled_occurrence(UUID, TEXT, JSONB, JSONB, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION stop_scheduled_repeat(UUID, TEXT) TO service_role;
