// THE rideability rule. One definition, imported by every backend consumer.
//
// This file exists because the rule was copy-pasted into three edge functions
// and they drifted. index.html gained a "gusty" clause — an hour also counts
// when kn>=12 and gusts>=20 — and none of the copies followed. Consequences:
//   * weekly-digest mailed "No sessions this week" for rideable days
//   * check-new-sessions created no reminder rows for gusty days
//   * process-reminders marked the 72h reminder skipped, which cascaded and
//     killed every shorter reminder for that session
//
// The app's copy is index.html `hourQualifies` / `dayGoodHours`. If you change
// one, change the other; tests/unit/rideability.test.ts pins this side.

export const toKnots   = (ms: number) => Math.round(ms * 1.94384)
export const isRainy   = (code: number) => code >= 51
export const speedTier = (kn: number) => kn >= 25 ? 3 : kn >= 20 ? 2 : kn >= 15 ? 1 : 0

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// How far the wind may sit off a listed direction and still count. Mirrors
// WIND_DIR_TOLERANCE_DEG in index.html — if these two drift, the app and the
// emails disagree about the same spot on the same day.
//
// 20, tightened from 30 on 2026-08-26. The Knokke spots (Riverwoods, Het
// Zoute, Surfers Paradise) genuinely need 250 deg or more; at 30 a listed W
// reached down to 240. 20 puts the floor exactly on 250.
//
// Note this is BELOW the 22.5 that tiles 45-degree spacing seamlessly, so two
// adjacent listed directions now leave a 5-degree hole between them (a spot
// listing W and NW refuses 292 deg). That is the price of the precise floor;
// widen the spot's own dirs rather than this constant if it bites.
export const WIND_DIR_TOLERANCE_DEG = 20

export function isWindDirOK(dir: number, spotDirs: number[]): boolean {
  if (!spotDirs || !spotDirs.length) return true
  return spotDirs.some(sd => angleDiff(dir, sd) <= WIND_DIR_TOLERANCE_DEG)
}

// Mirrors index.html `hourQualifies`.
export function hourQualifies(
  kn: number, dir: number, code: number, gustKn: number, spotDirs: number[],
): boolean {
  return (speedTier(kn) > 0 || (kn >= 12 && (gustKn || 0) >= 20))
    && !isRainy(code)
    && isWindDirOK(dir, spotDirs)
}

// Mirrors index.html `dayGoodHours`: of the qualifying hours, keep only those
// sitting in a run of 2+ consecutive clock hours. A lone windy hour is not a
// session. Callers pass hours in clock order.
// `hourOf` reads the clock hour off each item — callers name that field
// differently (`hr` in the digest, `hour` in the reminder functions).
export function consecutiveRuns<T>(qualifying: T[], hourOf: (h: T) => number): T[] {
  const hrs = new Set(qualifying.map(hourOf))
  return qualifying.filter(h => hrs.has(hourOf(h) - 1) || hrs.has(hourOf(h) + 1))
}

// ── DAY RATING ──────────────────────────────────────────────────────────────
//
// One rule for "how good is this day", shared by the reminder emails and the
// app. It is EXPERT-tuned on purpose: the tiers are named for riders who want
// power, so "Good" starts at 18 kn and the top tiers sit at 30 and 38 kn.
//
// It rates the AVERAGE over a window of consecutive good hours, not the peak.
// A single 30 kn hour inside a 17 kn afternoon is not an epic day; three
// hours averaging 30 kn are. Each tier asks for a 3h+ window at its average;
// a 2h window at the same average lands one tier lower.
//
// MIRRORED in index.html between the DAY RATING markers, because the app is a
// plain script and cannot import this file. tests/unit/rating-mirror.test.ts
// runs both copies over the same inputs and fails when they disagree.

export interface RatingTier { key: string; minKn: number; label: string; below: string }

// Top to bottom. `below` is the tier a 2h window earns instead of the 3h one.
export const RATING_TIERS: RatingTier[] = [
  { key: 'expert',   minKn: 38, label: 'Expert mode', below: 'epic' },
  { key: 'epic',     minKn: 30, label: 'Epic',        below: 'verygood' },
  { key: 'verygood', minKn: 25, label: 'Very Good',   below: 'good' },
  { key: 'good',     minKn: 18, label: 'Good',        below: 'good' },
]
// Under the lowest tier, a 15-18 kn average is still a session — a chill one.
// Below that only the gust rule (12 kn + gusts >= 20) can have qualified the
// hours, and that is labelled light wind rather than sold as a session.
export const CHILL_MIN_KN = 15
// Windows shorter than this earn the tier below.
export const FULL_SESSION_HOURS = 3

// Colours for the tiers, hottest at the top: the stronger the wind, the redder
// the badge. The app's .rating-* CSS carries the same values (pinned by the
// mirror test) and the reminder emails receive them in the payload, so a day
// looks the same in the inbox as on the spot page.
export const RATING_STYLE: Record<string, { fg: string; bg: string; border: string }> = {
  expert:    { fg: '#fca5a5', bg: 'rgba(239,68,68,.22)',    border: 'rgba(239,68,68,.45)' },
  epic:      { fg: '#fdba74', bg: 'rgba(249,115,22,.2)',    border: 'rgba(249,115,22,.42)' },
  verygood:  { fg: '#fde047', bg: 'rgba(234,179,8,.16)',    border: 'rgba(234,179,8,.36)' },
  good:      { fg: '#4ade80', bg: 'rgba(34,197,94,.16)',    border: 'rgba(34,197,94,.34)' },
  chill:     { fg: '#86efac', bg: 'rgba(134,239,172,.1)',   border: 'rgba(134,239,172,.24)' },
  lightwind: { fg: '#d9f99d', bg: 'rgba(217,249,157,.1)',   border: 'rgba(217,249,157,.24)' },
  none:      { fg: '#7a8fa8', bg: 'rgba(148,163,184,.08)',  border: 'rgba(148,163,184,.16)' },
  bad:       { fg: '#fca5a5', bg: 'rgba(239,68,68,.08)',    border: 'rgba(239,68,68,.18)' },
  danger:    { fg: '#fecaca', bg: 'rgba(220,38,38,.45)',    border: 'rgba(239,68,68,.7)' },
}

export interface RatedHour { hr: number; kn: number }
export interface SessionStats { goodHours: number; avgKn: number; avg3Kn: number; avg2Kn: number }

// The best mean over every run of consecutive clock hours at least `minLen`
// long. 0 when no window is long enough. Hours may arrive in any order.
export function bestWindowAvg(good: RatedHour[], minLen: number): number {
  const hrs = [...good].sort((a, b) => a.hr - b.hr)
  let best = 0
  for (let i = 0; i < hrs.length; i++) {
    let sum = 0
    for (let j = i; j < hrs.length; j++) {
      if (j > i && hrs[j].hr !== hrs[j - 1].hr + 1) break
      sum += hrs[j].kn
      const len = j - i + 1
      if (len >= minLen) best = Math.max(best, sum / len)
    }
  }
  return best
}

// Everything rateSession needs, from the qualifying hours of one day. Lone
// hours are dropped here (a lone windy hour is not a session), so callers may
// pass the raw qualifying list.
export function sessionStats(good: RatedHour[]): SessionStats {
  const run = consecutiveRuns(good, h => h.hr)
  const avgKn = run.length ? Math.round(run.reduce((s, h) => s + h.kn, 0) / run.length) : 0
  return {
    goodHours: run.length,
    avgKn,
    avg3Kn: bestWindowAvg(run, FULL_SESSION_HOURS),
    avg2Kn: bestWindowAvg(run, 2),
  }
}

export const isSnowy = (code: number) => [71,73,75,77,85,86].includes(code)
export const isStormy = (code: number) => [82,95,96,99].includes(code)

export interface Rating { tier: string; style: string; label: string }

// `tier` names the rung; `style` is the RATING_STYLE key that colours it.
export function rateSession(s: SessionStats, code: number, badDir: boolean, peakDayKn: number): Rating {
  if (isStormy(code)) return { tier: 'storm', style: 'danger', label: '❌ Storm ⚡' }
  const gh = s.goodHours
  if (gh === 0) {
    if (isRainy(code) && peakDayKn >= 10)
      return isSnowy(code) ? { tier: 'snow', style: 'bad', label: '❌ ❄️ Snow' }
                           : { tier: 'rain', style: 'bad', label: '❌ 🌧 Rain' }
    if (badDir && peakDayKn >= 15) return { tier: 'wrongdir', style: 'bad',  label: '❌ Wrong direction' }
    if (peakDayKn >= 10)           return { tier: 'toolight', style: 'none', label: '❌ Too light' }
    return                                { tier: 'nowind',   style: 'none', label: '❌ No wind' }
  }
  if (gh === 1) return { tier: 'brief', style: 'bad', label: '❌ Too brief (1h)' }
  for (const t of RATING_TIERS) {
    if (s.avg3Kn >= t.minKn) return { tier: t.key, style: t.key, label: `✅ ${gh}h · ${t.label}` }
    if (s.avg2Kn >= t.minKn) {
      const b = RATING_TIERS.find(x => x.key === t.below)!
      return { tier: b.key, style: b.key, label: `✅ ${gh}h · ${b.label}` }
    }
  }
  if (s.avg2Kn >= CHILL_MIN_KN) return { tier: 'chill', style: 'chill', label: `✅ ${gh}h · Chill` }
  return { tier: 'lightwind', style: 'lightwind', label: `⚡ ${gh}h · Light wind` }
}
