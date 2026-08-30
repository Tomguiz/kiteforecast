-- ══════════════════════════════════════════
-- KiteForecast — Supabase Schema
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Tide cache (shared across all users — one Stormglass call per spot per day)
CREATE TABLE IF NOT EXISTS tide_cache (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_key   text        NOT NULL,  -- 'lat,lon' rounded to 3 decimals
  date       date        NOT NULL,
  extremes   jsonb       NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (spot_key, date)
);

-- Shared forecast cache. One row per spot, written by the `forecast` edge
-- function: whichever rider looks first pays for the fetch and every rider
-- after them is served from here until the row ages past 2 hours.
CREATE TABLE IF NOT EXISTS forecast_cache (
  spot_key   text        PRIMARY KEY,  -- 'lat,lon' rounded to 3 decimals
  lat        double precision NOT NULL,
  lon        double precision NOT NULL,
  wx         jsonb       NOT NULL,
  marine     jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forecast_cache_fetched_at_idx ON forecast_cache (fetched_at);

-- No policies on purpose: only the service role touches this. Reads go through
-- the edge function so a client cannot poison a row every other rider sees.
ALTER TABLE forecast_cache ENABLE ROW LEVEL SECURITY;

-- Which rows a rider wants in the hourly table of a day, kept as one jsonb so
-- a new toggle does not need a migration. Mirrored in localStorage, so it works
-- signed out too; the column is what carries it between devices.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_prefs jsonb;

ALTER TABLE tide_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "all_select_tide_cache" ON tide_cache FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_insert_tide_cache" ON tide_cache FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Favourites table
CREATE TABLE IF NOT EXISTS favourites (
  id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text             NOT NULL,
  spot_name   text             NOT NULL,
  spot_label  text,
  spot_lat    double precision NOT NULL,
  spot_lon    double precision NOT NULL,
  spot_dirs   integer[],
  spot_days   integer[],        -- 0=Sun,1=Mon,...,6=Sat; NULL = any day
  created_at  timestamptz      NOT NULL DEFAULT now(),
  UNIQUE (email, spot_name)
);

ALTER TABLE favourites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "all_insert_favs" ON favourites FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_select_favs" ON favourites FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_delete_favs" ON favourites FOR DELETE TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_update_favs" ON favourites FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Profiles table (last_seen_at tracking)
CREATE TABLE IF NOT EXISTS profiles (
  email                   text        PRIMARY KEY,
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  digest_enabled          boolean     NOT NULL DEFAULT false,
  is_premium              boolean     NOT NULL DEFAULT false,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  phone_number            text,       -- E.164 format e.g. +32478123456
  sms_enabled             boolean     NOT NULL DEFAULT false,
  notifs_enabled          boolean     NOT NULL DEFAULT true,  -- master "Email reminders" toggle; false = pause all spot reminders
  is_admin                boolean     NOT NULL DEFAULT false
);

-- Backfill for existing profiles created before notifs_enabled existed
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notifs_enabled boolean NOT NULL DEFAULT true;

-- Grant admin to tom.guisgand@gmail.com (idempotent)
INSERT INTO profiles (email, is_admin) VALUES ('tom.guisgand@gmail.com', true)
ON CONFLICT (email) DO UPDATE SET is_admin = true;

-- Spot ownership claims
CREATE TABLE IF NOT EXISTS spot_claims (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text        NOT NULL,
  spot_name        text        NOT NULL,
  business_name    text,
  website          text,
  description      text,
  contact_name     text,
  contact_phone    text,
  phone_public     boolean     NOT NULL DEFAULT false,
  contact_email    text,
  email_public     boolean     NOT NULL DEFAULT false,
  address          text,
  livecam_url      text,
  lesson_url       text,
  gear_url         text,
  instagram_url    text,
  facebook_url     text,
  membership_note  text,
  verified         boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, spot_name)
);

-- Add missing columns to existing spot_claims tables (idempotent)
DO $$ BEGIN ALTER TABLE spot_claims ADD COLUMN display_name    text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_claims ADD COLUMN address         text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_claims ADD COLUMN lesson_url      text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_claims ADD COLUMN gear_url        text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_claims ADD COLUMN instagram_url   text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_claims ADD COLUMN facebook_url    text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_claims ADD COLUMN membership_note text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Published spot info (one row per spot — manually verified by admin or auto-promoted from spot_claims)
-- This is the table read by the frontend spot info card
CREATE TABLE IF NOT EXISTS spot_info (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_name        text        NOT NULL UNIQUE,
  display_name     text,                              -- overrides spot_name in the card header
  business_name    text,
  website          text,
  description      text,
  contact_name     text,
  phone            text,
  phone_public     boolean     NOT NULL DEFAULT false,
  email            text,
  email_public     boolean     NOT NULL DEFAULT false,
  address          text,
  livecam_url      text,
  lesson_url       text,
  gear_url         text,
  instagram_url    text,
  facebook_url     text,
  membership_note  text,
  verified         boolean     NOT NULL DEFAULT false,  -- true = owner has been verified
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE spot_info ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "all_select_spot_info" ON spot_info FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "owner_update_spot_info" ON spot_info FOR UPDATE TO authenticated
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "owner_insert_spot_info" ON spot_info FOR INSERT TO authenticated
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_delete_spot_info" ON spot_info FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Admin-added spots (merged into SPOTS array at startup for all users)
CREATE TABLE IF NOT EXISTS spot_overrides (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  loc        text        NOT NULL DEFAULT '',
  lat        double precision NOT NULL,
  lon        double precision NOT NULL,
  dirs       integer[]   NOT NULL DEFAULT '{}',
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE spot_overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "all_select_spot_overrides" ON spot_overrides FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_insert_spot_overrides" ON spot_overrides FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_update_spot_overrides" ON spot_overrides FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_delete_spot_overrides" ON spot_overrides FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- User-submitted spot suggestions (when search finds nothing)
CREATE TABLE IF NOT EXISTS spot_suggestions (
  id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  suggested_name  text             NOT NULL,
  location        text,
  lat             double precision,
  lon             double precision,
  note            text,
  submitted_by    text,
  reviewed        boolean          NOT NULL DEFAULT false,
  created_at      timestamptz      NOT NULL DEFAULT now()
);
DO $$ BEGIN ALTER TABLE spot_suggestions ADD COLUMN lat double precision; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_suggestions ADD COLUMN lon double precision; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_suggestions ADD COLUMN approved boolean NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_suggestions ADD COLUMN contact_name text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

ALTER TABLE spot_suggestions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "all_insert_suggestions" ON spot_suggestions FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_select_suggestions" ON spot_suggestions FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_delete_suggestions" ON spot_suggestions FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CTA click tracking (lesson, gear, website, instagram, facebook, livecam, live_wind)
CREATE TABLE IF NOT EXISTS spot_cta_clicks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_name   text        NOT NULL,
  cta_type    text        NOT NULL,  -- 'lesson' | 'gear' | 'website' | 'instagram' | 'facebook' | 'livecam' | 'live_wind'
  user_email  text,                  -- null for anonymous users
  clicked_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE spot_cta_clicks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "all_insert_cta_clicks" ON spot_cta_clicks FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_select_cta_clicks" ON spot_cta_clicks FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE spot_claims ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "all_insert_claims" ON spot_claims FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_select_claims" ON spot_claims FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_update_claims" ON spot_claims FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_delete_claims" ON spot_claims FOR DELETE TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "all_insert_profiles" ON profiles FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_select_profiles" ON profiles FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_update_profiles" ON profiles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Reminders table
CREATE TABLE IF NOT EXISTS reminders (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text          NOT NULL,
  spot_name       text          NOT NULL,
  spot_city       text,
  spot_country    text,
  spot_lat        double precision NOT NULL,
  spot_lon        double precision NOT NULL,
  spot_map_link   text,
  spot_dirs       integer[],        -- wind direction degrees e.g. {45,90}
  session_date    date          NOT NULL,
  notif_type      text          NOT NULL DEFAULT 'spot',  -- 'spot' or 'day'
  reminder_hours  integer       NOT NULL,  -- 72, 48, 24, 6, or 1
  send_at         timestamptz   NOT NULL,
  sent            boolean       NOT NULL DEFAULT false,
  skipped         boolean       NOT NULL DEFAULT false,  -- true when sent=true but no email was sent (bad forecast at send time)
  cancelled       boolean       NOT NULL DEFAULT false,
  app_link        text,
  -- Wind stats written when the 1h reminder fires (ground-truth session data)
  session_peak_kn    integer,
  session_min_kn     integer,
  session_hours      integer,
  session_rating     text,
  session_wind_dir   text,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- 3. Index for efficient querying of due reminders
CREATE INDEX IF NOT EXISTS reminders_due_idx
  ON reminders (send_at, sent, cancelled);

-- Unique constraint to prevent duplicate reminder rows per subscription window
DO $$ BEGIN
  ALTER TABLE reminders ADD CONSTRAINT reminders_unique_reminder
    UNIQUE (email, spot_name, notif_type, session_date, reminder_hours);
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 4. Row Level Security
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Allow frontend (anon + authenticated) to insert, update, read reminders
DO $$ BEGIN
  CREATE POLICY "all_insert" ON reminders FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_update" ON reminders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_select" ON reminders FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Confirmed "I'm going" sessions — the source of truth for the Stats section.
-- Wind stats are written by process-reminders when the 1h reminder fires and a
-- matching attendance exists. RLS lives in rls-hardening.sql.
CREATE TABLE IF NOT EXISTS session_attendances (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text          NOT NULL,
  nickname        text,
  spot_name       text          NOT NULL,
  spot_lat        double precision,
  spot_lon        double precision,
  session_date    date          NOT NULL,
  start_time      text,
  duration_h      integer,
  note            text,
  cancelled       boolean       NOT NULL DEFAULT false,
  -- Ground-truth wind stats, populated when the 1h reminder fires
  session_peak_kn    integer,
  session_min_kn     integer,
  session_hours      integer,
  session_rating     text,
  session_wind_dir   text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (email, spot_name, session_date)
);

-- Add stat columns for tables created before they existed (idempotent)
ALTER TABLE session_attendances ADD COLUMN IF NOT EXISTS session_peak_kn  integer;
ALTER TABLE session_attendances ADD COLUMN IF NOT EXISTS session_min_kn   integer;
ALTER TABLE session_attendances ADD COLUMN IF NOT EXISTS session_hours    integer;
ALTER TABLE session_attendances ADD COLUMN IF NOT EXISTS session_rating   text;
ALTER TABLE session_attendances ADD COLUMN IF NOT EXISTS session_wind_dir text;

-- 5. pg_cron jobs

-- Runs every 5 minutes — sends due reminders
SELECT cron.unschedule('process-reminders') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-reminders'
);
SELECT cron.schedule(
  'process-reminders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kpwmajtxmcfpakvonimf.supabase.co/functions/v1/process-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtwd21hanR4bWNmcGFrdm9uaW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTcyMjYsImV4cCI6MjA5MDczMzIyNn0.QfQuIQbnfVUOApPbOdvCRbNsVdb0SBAwMX-hvioGJmg'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Runs daily at 11:00 UTC (noon Brussels winter / 13:00 summer) —
-- checks for new eligible sessions on all subscribed spots
SELECT cron.unschedule('check-new-sessions') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'check-new-sessions'
);
SELECT cron.schedule(
  'check-new-sessions',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kpwmajtxmcfpakvonimf.supabase.co/functions/v1/check-new-sessions',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtwd21hanR4bWNmcGFrdm9uaW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTcyMjYsImV4cCI6MjA5MDczMzIyNn0.QfQuIQbnfVUOApPbOdvCRbNsVdb0SBAwMX-hvioGJmg'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Runs every Monday at 09:00 UTC — sends weekly digest to opted-in users
SELECT cron.unschedule('weekly-digest') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'weekly-digest'
);
SELECT cron.schedule(
  'weekly-digest',
  '0 9 * * 1',
  $$
  SELECT net.http_post(
    url     := 'https://kpwmajtxmcfpakvonimf.supabase.co/functions/v1/weekly-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtwd21hanR4bWNmcGFrdm9uaW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTcyMjYsImV4cCI6MjA5MDczMzIyNn0.QfQuIQbnfVUOApPbOdvCRbNsVdb0SBAwMX-hvioGJmg'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- User-submitted spot update suggestions
CREATE TABLE IF NOT EXISTS spot_update_suggestions (
  id               uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text             NOT NULL,
  spot_name        text             NOT NULL,
  website          text,
  livecam_url      text,
  lesson_url       text,
  gear_url         text,
  instagram_url    text,
  facebook_url     text,
  address          text,
  suggested_dirs   integer[],
  tip              text,
  reviewed         boolean          NOT NULL DEFAULT false,
  created_at       timestamptz      NOT NULL DEFAULT now()
);

ALTER TABLE spot_update_suggestions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "all_insert_spot_update_suggestions" ON spot_update_suggestions FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_select_spot_update_suggestions" ON spot_update_suggestions FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_update_spot_update_suggestions" ON spot_update_suggestions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "all_delete_spot_update_suggestions" ON spot_update_suggestions FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add spot_tip column to spot_info for community tips
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN spot_tip text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Structured spot attributes (Surfr-style): disciplines/facilities (multi),
-- water/tide/crowd/skill (single). All nullable. Idempotent.
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN disciplines text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN facilities  text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN water_type  text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN tide_pref   text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN crowd_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN skill_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Contribution points + earned premium
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN approved boolean NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
-- Phase 2: community-suggestable spot attributes (mirror spot_info). Idempotent.
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN disciplines text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN facilities  text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN water_type  text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN tide_pref   text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN crowd_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN skill_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN contribution_points integer NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN premium_until timestamptz; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_claims ADD COLUMN status text NOT NULL DEFAULT 'pending'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Home location for the digest's "near you" section. Nullable: most users
-- never set one, and the nearby section stays off without it.
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN home_lat double precision; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN home_lon double precision; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN home_label text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
-- Defaults to false on purpose: this changes what an existing user's weekly
-- email contains, so it is opt-in rather than a surprise.
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN digest_nearby_enabled boolean NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN digest_nearby_km integer NOT NULL DEFAULT 120; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- RWS live wind, phase 2: a rider-submitted live-wind page per spot. Takes
-- precedence over the automatic nearest-station link, which only covers the
-- Dutch/Belgian coast. Suggestions land in spot_update_suggestions and reach
-- spot_info only when an admin applies them.
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN live_wind_url text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN live_wind_url text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Profile columns that existed only in the live database
-- ---------------------------------------------------------------------------
-- These were applied by hand and never made it back into this file, so a
-- rebuild from schema.sql produced a profiles table the app could not read.
-- Verified against information_schema on 2026-08-19; defaults match live.
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN nickname text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN avatar_url text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN friend_session_notifs boolean NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN notify_friends_on_confirm boolean DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- One-click unsubscribe for broadcast email
-- ---------------------------------------------------------------------------
-- Announcement email goes to every profile, including people who have paused
-- reminders, so it needs an opt-out that works without signing in. The token is
-- the only credential the unsubscribe endpoint accepts.
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
-- gen_random_uuid() is VOLATILE, so ADD COLUMN rewrites the table and gives each
-- existing row its own token rather than reusing one evaluated default. The
-- unique index is what actually guarantees that; it fails loudly if it ever
-- stops holding, which beats silently shipping one token to everybody.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_unsubscribe_token_idx ON profiles (unsubscribe_token);

-- A broadcast is re-runnable by hand, and the failure mode of a half-finished
-- run is mailing the first N people twice. One row per (campaign, recipient),
-- written after the webhook accepts, makes a re-run resume instead of repeat.
CREATE TABLE IF NOT EXISTS broadcast_sends (
  campaign  text        NOT NULL,
  email     text        NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign, email)
);

ALTER TABLE broadcast_sends ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role writes here, and the service role bypasses
-- RLS. Enabling it with zero policies denies anon/authenticated outright.

-- ---------------------------------------------------------------------------
-- Outgoing email log
-- ---------------------------------------------------------------------------
-- Every email this project sends goes out through the Make.com webhook, and
-- until now nothing recorded that it happened: reminders, digests and notifies
-- were fire-and-forget. That made "what have we sent this rider?" unanswerable,
-- and left onboarding-style emails with no way to know they had already gone.
--
-- One row per recipient per send. Written by the edge functions with the service
-- role; never written from the browser.
CREATE TABLE IF NOT EXISTS email_log (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email     text        NOT NULL,
  kind      text        NOT NULL,   -- mirrors the payload's notification_type
  campaign  text,                   -- set for one-off blasts, null for the rest
  meta      jsonb,                  -- spot name, session date, … for context
  sent_at   timestamptz NOT NULL DEFAULT now()
);

-- The Users panel reads "everything sent to this rider, newest first".
CREATE INDEX IF NOT EXISTS email_log_email_sent_idx ON email_log (email, sent_at DESC);
-- "Has this rider had the onboarding email?" — the dedupe check.
CREATE INDEX IF NOT EXISTS email_log_kind_email_idx ON email_log (kind, email);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Same shape as profiles/reminders/favourites: your own row, or any row if
  -- admin. No insert/update/delete policies at all — only the service role
  -- writes here, and it bypasses RLS.
  CREATE POLICY "email_log_select_own" ON email_log FOR SELECT TO authenticated
    USING (email = auth_email() OR is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Email deal ads (shop sponsorships shown in the weekly digest)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_deals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name   text        NOT NULL,
  headline    text        NOT NULL,
  body        text,
  image_url   text,
  cta_label   text        NOT NULL DEFAULT 'Shop the deal',
  cta_url     text        NOT NULL,
  active      boolean     NOT NULL DEFAULT true,
  weight      integer     NOT NULL DEFAULT 1,
  starts_at   timestamptz,
  ends_at     timestamptz,
  impressions integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_deals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "all_select_email_deals" ON email_deals FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- writes are service-role / SQL only (no public write policy); the weekly-digest
-- function uses the service-role key, which bypasses RLS.

-- Seed the sponsor deal (idempotent: guarded on cta_url)
INSERT INTO email_deals (shop_name, headline, body, cta_label, cta_url, active, weight)
SELECT 'Billy Kite',
       'Gear up at Billy Kite',
       'Kites, boards & wetsuits from your local Belgian kite shop — sponsor of KiteForecast.',
       'Shop Billy Kite →',
       'https://billykite.be',
       true, 1
WHERE NOT EXISTS (SELECT 1 FROM email_deals WHERE cta_url = 'https://billykite.be');

-- ---------------------------------------------------------------------------
-- Rider profile: level and weight
-- ---------------------------------------------------------------------------
-- Both feed the kite-size recommendation, and the level is matched against
-- spot_info.skill_level to warn a beginner off an advanced spot. Nullable on
-- purpose: the app must work for riders who never fill these in, so every
-- consumer has to handle "unknown" rather than assume a default body weight.
-- kite_level mirrors SPOT_SKILL_LEVELS in index.html by index, so the rider
-- scale and the spot scale stay comparable.
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN kite_level text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN weight_kg integer; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD CONSTRAINT profiles_kite_level_chk
  CHECK (kite_level IS NULL OR kite_level IN ('Beginner','Intermediate','Advanced')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A plausible human range. Not cosmetic: the size formula divides by weight,
-- so a typo of 7 or 700 would produce a dangerous recommendation.
DO $$ BEGIN ALTER TABLE profiles ADD CONSTRAINT profiles_weight_chk
  CHECK (weight_kg IS NULL OR weight_kg BETWEEN 30 AND 150); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Power preference: how the rider likes to be canvassed for the wind. Refines
-- the kite-size suggestion; it never overrides the level, which carries the
-- capability part. See _shared/kite-size.ts.
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN power_pref text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD CONSTRAINT profiles_power_pref_chk
  CHECK (power_pref IS NULL OR power_pref IN ('underpowered','neutral','overpowered')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
