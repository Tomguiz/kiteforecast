-- ══════════════════════════════════════════
-- Seed: Belgian kite spots
-- Run after seed-riverwoods.sql (spot_info table must exist)
-- ══════════════════════════════════════════

-- 1. Icarus Kite School — Zeebrugge (Club North by Icarus)
INSERT INTO spot_info (
  spot_name, business_name, website, description,
  contact_name, phone, phone_public, email, email_public,
  address, livecam_url, lesson_url, gear_url,
  instagram_url, facebook_url, membership_note, verified
) VALUES (
  'Icarus Kite School',
  'Club North by Icarus',
  'https://www.clubnorthzeebrugge.be',
  'Belgium''s largest kite teaching zone — flat water, no breakers. IKO-certified school, beginner to advanced. Kids school (10–15y), wing foil & foil lessons. Free rescue standby vessel for members.',
  'Nico',
  '+32 50 54 76 59',
  true,
  'nico@icarussurfclub.be',
  true,
  'Zeedijk 50, 8380 Zeebrugge',
  'https://www.clubnorthzeebrugge.be/meteo-webcam',
  'https://icarus.vikingbookings.com/nl',
  'https://rent.clubnorthzeebrugge.be',
  'https://www.instagram.com/club_north_by_icarus/',
  'https://www.facebook.com/icarussurfclub',
  'Season Apr–Oct · Duo lesson €100pp · Private 2h €170 · Kids €120/1.5h · Membership €50/season incl. insurance & locker',
  false
)
ON CONFLICT (spot_name) DO UPDATE SET
  business_name   = EXCLUDED.business_name,
  website         = EXCLUDED.website,
  description     = EXCLUDED.description,
  contact_name    = EXCLUDED.contact_name,
  phone           = EXCLUDED.phone,
  phone_public    = EXCLUDED.phone_public,
  email           = EXCLUDED.email,
  email_public    = EXCLUDED.email_public,
  address         = EXCLUDED.address,
  livecam_url     = EXCLUDED.livecam_url,
  lesson_url      = EXCLUDED.lesson_url,
  gear_url        = EXCLUDED.gear_url,
  instagram_url   = EXCLUDED.instagram_url,
  facebook_url    = EXCLUDED.facebook_url,
  membership_note = EXCLUDED.membership_note,
  updated_at      = now();

-- 2. RBSC Duinbergen
INSERT INTO spot_info (
  spot_name, business_name, website, description,
  contact_name, phone, phone_public, email, email_public,
  address, livecam_url, lesson_url, gear_url,
  instagram_url, facebook_url, membership_note, verified
) VALUES (
  'Duinbergen',
  'RBSC Duinbergen',
  'https://www.rbsc.be/fr/clubs/duinbergen',
  'Royal Belgian Sailing Club — Duinbergen. Kitesurf & wingfoil lessons on request, catamaran rental, SUP & kayak free for members. Open May–October.',
  'Janneck Vaesen (Beachmaster)',
  '+32 50 51 55 93',
  true,
  'duinbergen@rbsc.be',
  true,
  'Zeedijk 430, 8301 Knokke-Heist',
  NULL,
  'https://www.rbsc.be/fr/clubs/duinbergen',
  'https://www.rbsc.be/fr/clubs/duinbergen',
  'https://www.instagram.com/rbsc_1863/',
  'https://www.facebook.com/RoyalBelgianSailingClub/',
  'Members get free SUP, kayak & sailing equipment · Kite lessons on request · Season May–Oct',
  false
)
ON CONFLICT (spot_name) DO UPDATE SET
  business_name   = EXCLUDED.business_name,
  website         = EXCLUDED.website,
  description     = EXCLUDED.description,
  contact_name    = EXCLUDED.contact_name,
  phone           = EXCLUDED.phone,
  phone_public    = EXCLUDED.phone_public,
  email           = EXCLUDED.email,
  email_public    = EXCLUDED.email_public,
  address         = EXCLUDED.address,
  lesson_url      = EXCLUDED.lesson_url,
  gear_url        = EXCLUDED.gear_url,
  instagram_url   = EXCLUDED.instagram_url,
  facebook_url    = EXCLUDED.facebook_url,
  membership_note = EXCLUDED.membership_note,
  updated_at      = now();

-- 3. RBSC Het Zoute (app spot name: 'Knokke Beach')
INSERT INTO spot_info (
  spot_name, business_name, website, description,
  contact_name, phone, phone_public, email, email_public,
  address, livecam_url, lesson_url, gear_url,
  instagram_url, facebook_url, membership_note, verified
) VALUES (
  'Knokke Beach',
  'RBSC Het Zoute',
  'https://www.rbsc.be/fr/clubs/zoute',
  'Royal Belgian Sailing Club — Het Zoute. Kitesurf & wingfoil lessons, catamaran rental, SUP & kayak free for members. Open April–November.',
  'Olivier Grandjean (Beachmaster)',
  '+32 50 62 11 71',
  true,
  'zoute@rbsc.be',
  true,
  'Zeedijk 871 Y, 8300 Knokke-Heist',
  NULL,
  'https://www.rbsc.be/fr/clubs/zoute',
  'https://www.rbsc.be/fr/clubs/zoute',
  'https://www.instagram.com/rbsc_1863/',
  'https://www.facebook.com/RoyalBelgianSailingClub/',
  'Members get free SUP, kayak & sailing equipment · Kite & wingfoil lessons · Season Apr–Nov',
  false
)
ON CONFLICT (spot_name) DO UPDATE SET
  business_name   = EXCLUDED.business_name,
  website         = EXCLUDED.website,
  description     = EXCLUDED.description,
  contact_name    = EXCLUDED.contact_name,
  phone           = EXCLUDED.phone,
  phone_public    = EXCLUDED.phone_public,
  email           = EXCLUDED.email,
  email_public    = EXCLUDED.email_public,
  address         = EXCLUDED.address,
  lesson_url      = EXCLUDED.lesson_url,
  gear_url        = EXCLUDED.gear_url,
  instagram_url   = EXCLUDED.instagram_url,
  facebook_url    = EXCLUDED.facebook_url,
  membership_note = EXCLUDED.membership_note,
  updated_at      = now();
