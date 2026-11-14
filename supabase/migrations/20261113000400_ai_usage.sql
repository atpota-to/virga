-- Counters for the AI help while posting (/api/ai/*): two monthly allowance
-- tables and a daily cost ceiling. Written only by Virga's server with the
-- service-role key (server/ai/usage.js, server/ai/rateLimit.js); nothing else
-- may touch them. Safe to re-apply.
--
-- The writes go through the functions at the bottom rather than a
-- read-then-upsert from the server: each check-and-increment is one statement
-- on the row, so requests that arrive together can't both read the same count
-- and pass a monthly allowance or the daily ceiling between them.

-- Monthly allowance: adviser reads (count) and style readings (style_count),
-- one row per (did, month). Separate columns so one never eats the other.
CREATE TABLE IF NOT EXISTS posting_adviser_usage (
  did         TEXT        NOT NULL,
  month       TEXT        NOT NULL,              -- 'YYYY-MM' (UTC)
  count       INTEGER     NOT NULL DEFAULT 0,    -- /api/ai/analyze-post
  style_count INTEGER     NOT NULL DEFAULT 0,    -- /api/ai/synthesize-style
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (did, month)
);

COMMENT ON TABLE posting_adviser_usage IS
  'AI adviser allowances per account per UTC month. Service role only.';
COMMENT ON COLUMN posting_adviser_usage.count IS
  'Adviser reads this month (AI_ADVISER_MONTHLY_LIMIT).';
COMMENT ON COLUMN posting_adviser_usage.style_count IS
  'Style readings this month (AI_STYLE_MONTHLY_LIMIT), separate from the adviser count.';

-- Monthly allowance: image descriptions, one row per (did, month).
CREATE TABLE IF NOT EXISTS alt_text_usage (
  did         TEXT        NOT NULL,
  month       TEXT        NOT NULL,              -- 'YYYY-MM' (UTC)
  count       INTEGER     NOT NULL DEFAULT 0,    -- /api/ai/alt-text
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (did, month)
);

COMMENT ON TABLE alt_text_usage IS
  'Image descriptions per account per UTC month (AI_ALT_TEXT_MONTHLY_LIMIT). Service role only.';

-- Daily ceiling across all three AI endpoints (AI_DAILY_LIMIT), one row per
-- (did, day). A slot is taken before the model is called and never given back.
CREATE TABLE IF NOT EXISTS ai_rate_limit (
  did         TEXT        NOT NULL,
  day         TEXT        NOT NULL,              -- 'YYYY-MM-DD' (UTC)
  count       INTEGER     NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (did, day)
);

COMMENT ON TABLE ai_rate_limit IS
  'AI requests per account per UTC day, the cost ceiling (AI_DAILY_LIMIT). Service role only.';

-- Take one of this month's uses of an allowance if any is left, before the
-- model is called. The increment and the check are one statement (the
-- conditional DO UPDATE), so requests arriving together can't all read the
-- same count and pass the limit between them. p_allowance is the server's
-- allowance id: adviser | style | altText. Returns one row: whether the use
-- was taken, and the month's count after it (or as it stands, when refused).
-- A limit below one takes nothing.
CREATE OR REPLACE FUNCTION reserve_ai_usage(p_allowance TEXT, p_did TEXT, p_month TEXT, p_limit INTEGER)
RETURNS TABLE (allowed BOOLEAN, used INTEGER)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_allowance NOT IN ('adviser', 'style', 'altText') THEN
    RAISE EXCEPTION 'unknown AI allowance %', p_allowance USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NOT NULL AND p_limit >= 1 THEN
    IF p_allowance = 'adviser' THEN
      INSERT INTO posting_adviser_usage AS u (did, month, count)
      VALUES (p_did, p_month, 1)
      ON CONFLICT (did, month) DO UPDATE
        SET count = u.count + 1, updated_at = now()
        WHERE u.count < p_limit
      RETURNING u.count INTO v_count;
    ELSIF p_allowance = 'style' THEN
      INSERT INTO posting_adviser_usage AS u (did, month, style_count)
      VALUES (p_did, p_month, 1)
      ON CONFLICT (did, month) DO UPDATE
        SET style_count = u.style_count + 1, updated_at = now()
        WHERE u.style_count < p_limit
      RETURNING u.style_count INTO v_count;
    ELSE
      INSERT INTO alt_text_usage AS u (did, month, count)
      VALUES (p_did, p_month, 1)
      ON CONFLICT (did, month) DO UPDATE
        SET count = u.count + 1, updated_at = now()
        WHERE u.count < p_limit
      RETURNING u.count INTO v_count;
    END IF;
    IF FOUND THEN
      allowed := TRUE;
      used := v_count;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;
  IF p_allowance = 'adviser' THEN
    SELECT u.count INTO v_count FROM posting_adviser_usage u WHERE u.did = p_did AND u.month = p_month;
  ELSIF p_allowance = 'style' THEN
    SELECT u.style_count INTO v_count FROM posting_adviser_usage u WHERE u.did = p_did AND u.month = p_month;
  ELSE
    SELECT u.count INTO v_count FROM alt_text_usage u WHERE u.did = p_did AND u.month = p_month;
  END IF;
  allowed := FALSE;
  used := COALESCE(v_count, 0);
  RETURN NEXT;
END;
$$;

-- Give back a use reserve_ai_usage took, for a request that ended without a
-- usable answer (the model failed, answered nothing, or the daily ceiling
-- refused it). Never below zero. Returns the month's count after it.
CREATE OR REPLACE FUNCTION release_ai_usage(p_allowance TEXT, p_did TEXT, p_month TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_allowance = 'adviser' THEN
    UPDATE posting_adviser_usage u
       SET count = GREATEST(u.count - 1, 0), updated_at = now()
     WHERE u.did = p_did AND u.month = p_month
    RETURNING u.count INTO v_count;
  ELSIF p_allowance = 'style' THEN
    UPDATE posting_adviser_usage u
       SET style_count = GREATEST(u.style_count - 1, 0), updated_at = now()
     WHERE u.did = p_did AND u.month = p_month
    RETURNING u.style_count INTO v_count;
  ELSIF p_allowance = 'altText' THEN
    UPDATE alt_text_usage u
       SET count = GREATEST(u.count - 1, 0), updated_at = now()
     WHERE u.did = p_did AND u.month = p_month
    RETURNING u.count INTO v_count;
  ELSE
    RAISE EXCEPTION 'unknown AI allowance %', p_allowance USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(v_count, 0);
END;
$$;

-- Take one of today's slots if any is left. The increment and the check are
-- one statement (the conditional DO UPDATE), so requests arriving together
-- can't pass the ceiling between them. Returns one row: whether the slot was
-- taken, and the day's count after it (or as it stands, when refused).
CREATE OR REPLACE FUNCTION consume_ai_daily(p_did TEXT, p_day TEXT, p_limit INTEGER)
RETURNS TABLE (allowed BOOLEAN, used INTEGER)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_limit IS NOT NULL AND p_limit >= 1 THEN
    INSERT INTO ai_rate_limit AS r (did, day, count)
    VALUES (p_did, p_day, 1)
    ON CONFLICT (did, day) DO UPDATE
      SET count = r.count + 1, updated_at = now()
      WHERE r.count < p_limit
    RETURNING r.count INTO v_count;
    IF FOUND THEN
      allowed := TRUE;
      used := v_count;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;
  SELECT r.count INTO v_count FROM ai_rate_limit r WHERE r.did = p_did AND r.day = p_day;
  allowed := FALSE;
  used := COALESCE(v_count, 0);
  RETURN NEXT;
END;
$$;

-- Service role only: RLS with no policies denies everyone else, and the
-- default grants Supabase gives anon and authenticated go too.
ALTER TABLE posting_adviser_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE alt_text_usage        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_rate_limit         ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE posting_adviser_usage FROM anon, authenticated;
REVOKE ALL ON TABLE alt_text_usage        FROM anon, authenticated;
REVOKE ALL ON TABLE ai_rate_limit         FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE posting_adviser_usage, alt_text_usage, ai_rate_limit TO service_role;

REVOKE ALL ON FUNCTION reserve_ai_usage(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_ai_usage(TEXT, TEXT, TEXT)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION consume_ai_daily(TEXT, TEXT, INTEGER)       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_ai_usage(TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION release_ai_usage(TEXT, TEXT, TEXT)          TO service_role;
GRANT EXECUTE ON FUNCTION consume_ai_daily(TEXT, TEXT, INTEGER)       TO service_role;
