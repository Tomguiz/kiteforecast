-- ══════════════════════════════════════════════════════════════════════════
-- KiteForecast — RLS HARDENING MIGRATION
-- Run this in the Supabase SQL Editor AFTER schema.sql.
--
-- WHY: every original policy was `TO anon ... USING (true) WITH CHECK (true)`,
-- which — combined with the public anon key shipped in index.html — let anyone
-- read all PII, grant themselves premium/admin, and delete/modify any row.
--
-- This migration replaces those policies with identity-scoped ones based on the
-- authenticated user's email (auth.jwt()->>'email'), keeps the few genuinely
-- anonymous write paths (CTA clicks, tide cache), and protects the sensitive
-- profile columns (is_premium, is_admin, stripe_*, contribution_points,
-- premium_until) so only the service role / DB triggers can change them.
--
-- The service role (used by edge functions like stripe-webhook) BYPASSES RLS
-- entirely, so server-side flows keep working.
--
-- Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 0. Helpers ─────────────────────────────────────────────────────────────

-- Current authenticated user's email (NULL for anon).
CREATE OR REPLACE FUNCTION auth_email() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt() ->> 'email', '')
$$;

-- True when the current user is flagged is_admin in profiles.
-- SECURITY DEFINER so the lookup itself isn't blocked by profiles' own RLS.
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE email = nullif(auth.jwt() ->> 'email', '') AND is_admin = true
  )
$$;

-- Helper: drop every policy on a table so we can recreate cleanly.
CREATE OR REPLACE FUNCTION _drop_all_policies(tbl regclass) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = (SELECT relname FROM pg_class WHERE oid = tbl)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', pol.policyname, tbl);
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. PROFILES — own row only; protected columns are server-only
-- ══════════════════════════════════════════════════════════════════════════
SELECT _drop_all_policies('profiles');

-- Read: your own row, or any row if admin.
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT TO authenticated
  USING (email = auth_email() OR is_admin());

-- Insert: only your own row (e.g. first-seen upsert). Protected columns are
-- additionally guarded by the trigger below.
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT TO authenticated
  WITH CHECK (email = auth_email());

-- Update: only your own row (admins via trigger bypass).
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated
  USING (email = auth_email() OR is_admin())
  WITH CHECK (email = auth_email() OR is_admin());

-- NOTE: no anon access. Signed-out users never need to touch profiles.

-- Public social view: exposes ONLY non-sensitive fields (email + nickname) so
-- friend search and friend/attendee name display keep working WITHOUT leaking
-- phone numbers, stripe ids, premium/admin flags, or contribution data.
-- The client reads this view for any cross-user lookup; the base `profiles`
-- table is restricted to the caller's own row above.
-- security_invoker=off (default): the view runs with its owner's rights, so it
-- is NOT re-filtered by profiles' own-row RLS — but it only ever selects the two
-- safe columns, so that is intentional and safe.
-- Defensive: `nickname` is added via the dashboard, not schema.sql. Ensure it
-- exists so the view never fails on a fresh DB.
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN nickname text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DROP VIEW IF EXISTS public_profiles;
CREATE VIEW public_profiles AS
  SELECT email, nickname FROM profiles;
GRANT SELECT ON public_profiles TO authenticated;

-- Trigger: reject client changes to privilege/billing columns.
-- Service role bypasses RLS but NOT triggers, so we must let it (and the
-- postgres superuser used by the SQL editor / internal jobs) through.
--
-- Robust rule: ONLY ordinary end-users come through PostgREST as the 'anon' or
-- 'authenticated' role. ANYTHING ELSE — service_role (the Stripe webhook),
-- postgres/supabase_admin (SQL editor, migrations) — is privileged. Detecting
-- "not an end-user" is far more reliable than enumerating service-role signals,
-- which vary across SECURITY DEFINER contexts and connection types.
CREATE OR REPLACE FUNCTION protect_profile_columns() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  jwt_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  pg_role  text := current_user;            -- e.g. authenticator / postgres / supabase_admin
  is_enduser boolean;
BEGIN
  -- An ordinary end-user request: PostgREST switched the role to anon/authenticated.
  -- coalesce each side to '' — `NULL IN (...)` yields NULL (not false), and a NULL
  -- here would poison the IF below into the REVERT branch, blocking even the
  -- service role / postgres superuser. This was the cause of paid users not
  -- getting premium: the webhook's write was silently reverted.
  is_enduser := (coalesce(jwt_role, '') IN ('anon', 'authenticated'))
                OR (coalesce(pg_role, '') IN ('anon', 'authenticated'));

  -- Privileged (service role, superuser, internal) OR an admin end-user: allow.
  IF NOT is_enduser OR is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- New self-created rows must not arrive pre-elevated.
    NEW.is_premium         := COALESCE((SELECT false), false);
    NEW.is_admin           := false;
    NEW.stripe_customer_id := NULL;
    NEW.stripe_subscription_id := NULL;
    NEW.contribution_points := COALESCE(NEW.contribution_points, 0);
    -- contribution_points/premium_until intentionally forced to safe defaults
    NEW.contribution_points := 0;
    NEW.premium_until       := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: preserve protected columns at their existing values.
  NEW.is_premium             := OLD.is_premium;
  NEW.is_admin               := OLD.is_admin;
  NEW.stripe_customer_id     := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.contribution_points    := OLD.contribution_points;
  NEW.premium_until          := OLD.premium_until;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_profile_columns_trg ON profiles;
CREATE TRIGGER protect_profile_columns_trg
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_profile_columns();

-- ══════════════════════════════════════════════════════════════════════════
-- 2. REMINDERS — own email only
-- ══════════════════════════════════════════════════════════════════════════
SELECT _drop_all_policies('reminders');

CREATE POLICY "reminders_select_own" ON reminders FOR SELECT TO authenticated
  USING (email = auth_email() OR is_admin());
CREATE POLICY "reminders_insert_own" ON reminders FOR INSERT TO authenticated
  WITH CHECK (email = auth_email());
CREATE POLICY "reminders_update_own" ON reminders FOR UPDATE TO authenticated
  USING (email = auth_email() OR is_admin())
  WITH CHECK (email = auth_email() OR is_admin());
CREATE POLICY "reminders_delete_own" ON reminders FOR DELETE TO authenticated
  USING (email = auth_email() OR is_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 3. FAVOURITES — own email only
-- ══════════════════════════════════════════════════════════════════════════
SELECT _drop_all_policies('favourites');

CREATE POLICY "favs_select_own" ON favourites FOR SELECT TO authenticated
  USING (email = auth_email() OR is_admin());
CREATE POLICY "favs_insert_own" ON favourites FOR INSERT TO authenticated
  WITH CHECK (email = auth_email());
CREATE POLICY "favs_update_own" ON favourites FOR UPDATE TO authenticated
  USING (email = auth_email()) WITH CHECK (email = auth_email());
CREATE POLICY "favs_delete_own" ON favourites FOR DELETE TO authenticated
  USING (email = auth_email() OR is_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 4. FRIENDSHIPS — requester or recipient only
--    (table created outside schema.sql; ensure RLS is on)
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE IF EXISTS friendships ENABLE ROW LEVEL SECURITY;
SELECT _drop_all_policies('friendships');

CREATE POLICY "friendships_select_party" ON friendships FOR SELECT TO authenticated
  USING (requester = auth_email() OR recipient = auth_email() OR is_admin());
-- You may only create requests as yourself.
CREATE POLICY "friendships_insert_self" ON friendships FOR INSERT TO authenticated
  WITH CHECK (requester = auth_email());
-- Either party may update (accept/decline) or delete (cancel/remove).
CREATE POLICY "friendships_update_party" ON friendships FOR UPDATE TO authenticated
  USING (requester = auth_email() OR recipient = auth_email())
  WITH CHECK (requester = auth_email() OR recipient = auth_email());
CREATE POLICY "friendships_delete_party" ON friendships FOR DELETE TO authenticated
  USING (requester = auth_email() OR recipient = auth_email());

-- ══════════════════════════════════════════════════════════════════════════
-- 5. SESSION_ATTENDANCES — own email; friends may READ (for the social feature)
--    (table created outside schema.sql; ensure RLS is on)
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE IF EXISTS session_attendances ENABLE ROW LEVEL SECURITY;
SELECT _drop_all_policies('session_attendances');

-- Read your own rows, an accepted friend's rows, or all rows if admin.
CREATE POLICY "attend_select_own_or_friend" ON session_attendances FOR SELECT TO authenticated
  USING (
    email = auth_email()
    OR is_admin()
    OR EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND ( (f.requester = auth_email() AND f.recipient = session_attendances.email)
           OR (f.recipient = auth_email() AND f.requester = session_attendances.email) )
    )
  );
CREATE POLICY "attend_insert_own" ON session_attendances FOR INSERT TO authenticated
  WITH CHECK (email = auth_email());
CREATE POLICY "attend_update_own" ON session_attendances FOR UPDATE TO authenticated
  USING (email = auth_email()) WITH CHECK (email = auth_email());
CREATE POLICY "attend_delete_own" ON session_attendances FOR DELETE TO authenticated
  USING (email = auth_email() OR is_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 6. SPOT_OVERRIDES — public read, ADMIN-ONLY write
--    (these merge into the global SPOTS list for everyone)
-- ══════════════════════════════════════════════════════════════════════════
SELECT _drop_all_policies('spot_overrides');

CREATE POLICY "overrides_select_all" ON spot_overrides FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "overrides_admin_insert" ON spot_overrides FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "overrides_admin_update" ON spot_overrides FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "overrides_admin_delete" ON spot_overrides FOR DELETE TO authenticated USING (is_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 7. SPOT_INFO — public read; ADMIN or verified OWNER may write
-- ══════════════════════════════════════════════════════════════════════════
SELECT _drop_all_policies('spot_info');

CREATE POLICY "spot_info_select_all" ON spot_info FOR SELECT TO anon, authenticated USING (true);
-- Owner = the email on the row matches the caller; admins always allowed.
CREATE POLICY "spot_info_insert" ON spot_info FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR email = auth_email());
CREATE POLICY "spot_info_update" ON spot_info FOR UPDATE TO authenticated
  USING (is_admin() OR email = auth_email())
  WITH CHECK (is_admin() OR email = auth_email());
CREATE POLICY "spot_info_delete" ON spot_info FOR DELETE TO authenticated
  USING (is_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 8. SPOT_CLAIMS — caller may manage own claims; admin sees/moderates all
-- ══════════════════════════════════════════════════════════════════════════
SELECT _drop_all_policies('spot_claims');

CREATE POLICY "claims_select_own_or_admin" ON spot_claims FOR SELECT TO authenticated
  USING (email = auth_email() OR is_admin());
CREATE POLICY "claims_insert_own" ON spot_claims FOR INSERT TO authenticated
  WITH CHECK (email = auth_email());
CREATE POLICY "claims_update_own_or_admin" ON spot_claims FOR UPDATE TO authenticated
  USING (email = auth_email() OR is_admin())
  WITH CHECK (email = auth_email() OR is_admin());
CREATE POLICY "claims_delete_own_or_admin" ON spot_claims FOR DELETE TO authenticated
  USING (email = auth_email() OR is_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 9. SPOT_SUGGESTIONS — authenticated insert; admin-only read/moderate
--    (client requires sign-in to submit; previously anyone could read all)
-- ══════════════════════════════════════════════════════════════════════════
SELECT _drop_all_policies('spot_suggestions');

CREATE POLICY "suggestions_insert_auth" ON spot_suggestions FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth_email() OR submitted_by IS NULL);
CREATE POLICY "suggestions_select_own_or_admin" ON spot_suggestions FOR SELECT TO authenticated
  USING (submitted_by = auth_email() OR is_admin());
CREATE POLICY "suggestions_update_admin" ON spot_suggestions FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "suggestions_delete_admin" ON spot_suggestions FOR DELETE TO authenticated
  USING (is_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 10. SPOT_UPDATE_SUGGESTIONS — same model as spot_suggestions
-- ══════════════════════════════════════════════════════════════════════════
SELECT _drop_all_policies('spot_update_suggestions');

CREATE POLICY "upd_suggestions_insert_auth" ON spot_update_suggestions FOR INSERT TO authenticated
  WITH CHECK (email = auth_email());
CREATE POLICY "upd_suggestions_select_own_or_admin" ON spot_update_suggestions FOR SELECT TO authenticated
  USING (email = auth_email() OR is_admin());
CREATE POLICY "upd_suggestions_update_admin" ON spot_update_suggestions FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "upd_suggestions_delete_admin" ON spot_update_suggestions FOR DELETE TO authenticated
  USING (is_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 11. SPOT_CTA_CLICKS — anonymous insert (analytics), admin-only read
-- ══════════════════════════════════════════════════════════════════════════
SELECT _drop_all_policies('spot_cta_clicks');

CREATE POLICY "cta_insert_all" ON spot_cta_clicks FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "cta_select_admin" ON spot_cta_clicks FOR SELECT TO authenticated USING (is_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 12. TIDE_CACHE — shared cache; read by all, written by service role only
--     (tide-proxy uses the service role, so anon write is unnecessary)
-- ══════════════════════════════════════════════════════════════════════════
SELECT _drop_all_policies('tide_cache');

CREATE POLICY "tide_select_all" ON tide_cache FOR SELECT TO anon, authenticated USING (true);
-- No anon/authenticated INSERT: the tide-proxy edge function writes with the
-- service role, which bypasses RLS. Drops a free vector for cache poisoning.

-- ══════════════════════════════════════════════════════════════════════════
-- Done. Cleanup helper.
-- ══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS _drop_all_policies(regclass);
