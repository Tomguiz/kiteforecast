-- ══════════════════════════════════════════
-- KiteForecast — Supabase Schema
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Reminders table
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

-- 4. Row Level Security
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Allow frontend (anon) to insert new reminders
CREATE POLICY "anon_insert" ON reminders
  FOR INSERT TO anon
  WITH CHECK (true);

-- Allow frontend (anon) to cancel their own reminders
CREATE POLICY "anon_cancel" ON reminders
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (cancelled = true);

-- 5. pg_cron job — runs every 5 minutes, calls the edge function
-- Replace ANON_KEY below with your project anon key
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
