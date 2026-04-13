-- ══════════════════════════════════════════
-- KiteForecast — Supabase Schema
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Favourites table
CREATE TABLE IF NOT EXISTS favourites (
  id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text             NOT NULL,
  spot_name   text             NOT NULL,
  spot_label  text,
  spot_lat    double precision NOT NULL,
  spot_lon    double precision NOT NULL,
  spot_dirs   integer[],
  created_at  timestamptz      NOT NULL DEFAULT now(),
  UNIQUE (email, spot_name)
);

ALTER TABLE favourites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "anon_insert_favs" ON favourites FOR INSERT TO anon WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "anon_select_favs" ON favourites FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "anon_delete_favs" ON favourites FOR DELETE TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "anon_update_favs" ON favourites FOR UPDATE TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Reminders table
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
  cancelled       boolean       NOT NULL DEFAULT false,
  app_link        text,
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

-- Allow frontend (anon) to insert new reminders
DO $$ BEGIN
  CREATE POLICY "anon_insert" ON reminders FOR INSERT TO anon WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow frontend (anon) to cancel their own reminders
DO $$ BEGIN
  CREATE POLICY "anon_cancel" ON reminders FOR UPDATE TO anon USING (true) WITH CHECK (cancelled = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow frontend (anon) to read reminders (for cross-session sync)
DO $$ BEGIN
  CREATE POLICY "anon_select" ON reminders FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
