-- ══════════════════════════════════════════════════════════════════════════
-- FIX: paid users not getting premium
--
-- Cause: the protect_profile_columns trigger (added in rls-hardening.sql) was
-- mis-detecting the Stripe webhook's service-role write as an ordinary end-user
-- and silently reverting is_premium back to its old value (false).
--
-- This re-creates the trigger function with robust privileged-caller detection:
-- only anon/authenticated PostgREST requests are treated as end-users; the
-- service role (webhook) and postgres superuser (SQL editor) are allowed through.
--
-- Run this whole file in the Supabase SQL Editor. Idempotent.
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION protect_profile_columns() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  jwt_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  pg_role  text := current_user;
  is_enduser boolean;
BEGIN
  -- coalesce to '' so a NULL role (service role / postgres) can't poison the
  -- IN () into NULL and fall through to the REVERT branch.
  is_enduser := (coalesce(jwt_role, '') IN ('anon', 'authenticated'))
                OR (coalesce(pg_role, '') IN ('anon', 'authenticated'));

  IF NOT is_enduser OR is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_premium         := false;
    NEW.is_admin           := false;
    NEW.stripe_customer_id := NULL;
    NEW.stripe_subscription_id := NULL;
    NEW.contribution_points := 0;
    NEW.premium_until       := NULL;
    RETURN NEW;
  END IF;

  NEW.is_premium             := OLD.is_premium;
  NEW.is_admin               := OLD.is_admin;
  NEW.stripe_customer_id     := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.contribution_points    := OLD.contribution_points;
  NEW.premium_until          := OLD.premium_until;
  RETURN NEW;
END $$;

-- Trigger definition is unchanged; re-assert it to be safe.
DROP TRIGGER IF EXISTS protect_profile_columns_trg ON profiles;
CREATE TRIGGER protect_profile_columns_trg
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_profile_columns();

-- ── Verify the fix works (run as SQL editor = privileged, so this must stick) ──
-- This should now succeed where it previously silently reverted.
-- SELECT to see who paid but isn't premium:
SELECT email, is_premium, stripe_customer_id
FROM profiles
WHERE stripe_customer_id IS NOT NULL AND is_premium = false;
