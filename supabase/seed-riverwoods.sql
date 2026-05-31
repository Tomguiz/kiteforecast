-- ══════════════════════════════════════════
-- Seed: Riverwoods Beach Club — Knokke-Heist
-- Source: riverwoodsbeachclub.be + third-party research (site is JS-only)
-- Kite school: Jackfly (loic@jackfly.be · +32 495 38 43 84)
-- Run this in the Supabase SQL Editor
-- ══════════════════════════════════════════

INSERT INTO spot_info (
  spot_name,
  business_name,
  website,
  description,
  contact_name,
  phone,
  phone_public,
  email,
  email_public,
  address,
  livecam_url,
  lesson_url,
  gear_url,
  instagram_url,
  facebook_url,
  membership_note,
  verified
) VALUES (
  'Riverwoods Beachclub',
  'Riverwoods Beach Club · Jackfly Kite School',
  'https://riverwoodsbeachclub.be/en',
  'Belgium''s oldest kite school, based at Riverwoods Beach Club. IKO-certified, 20+ years experience. Max 2 students per instructor, 2h sessions for all levels. Rescue on site, showers, bar & gastronomy on the beach.',
  'Loïc (Jackfly)',
  '+32 50 62 84 04',
  true,
  'beachclub@riverwoods.net',
  true,
  'Zeedijk-Het Zoute 832 B, 8300 Knokke-Heist',
  NULL,
  'https://riverwoodsbeachclub.be/en/jackfly',
  'https://riverwoodsbeachclub.be/en/kitesurf',
  'https://www.instagram.com/riverwoodsbeachclub/',
  'https://www.facebook.com/RWBCbytero/',
  'Day pass €15–20 incl. insurance & showers · Week €65 · Season €120 · Kite membership €50',
  false
)
ON CONFLICT (spot_name) DO UPDATE SET
  business_name    = EXCLUDED.business_name,
  website          = EXCLUDED.website,
  description      = EXCLUDED.description,
  contact_name     = EXCLUDED.contact_name,
  phone            = EXCLUDED.phone,
  phone_public     = EXCLUDED.phone_public,
  email            = EXCLUDED.email,
  email_public     = EXCLUDED.email_public,
  address          = EXCLUDED.address,
  lesson_url       = EXCLUDED.lesson_url,
  gear_url         = EXCLUDED.gear_url,
  instagram_url    = EXCLUDED.instagram_url,
  facebook_url     = EXCLUDED.facebook_url,
  membership_note  = EXCLUDED.membership_note,
  updated_at       = now();
