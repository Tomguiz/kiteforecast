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
// It rates the AVERAGE of the day's best three rideable hours, not the peak.
// A single 30 kn hour inside a 17 kn afternoon is not an epic day; three
// hours averaging 30 kn are — and they need not be back to back, because a
// rider who has the whole day rides all of it. A session of only two hours is
// rated on those two and lands one tier lower.
//
// Why the best three and not the whole session: a 7h day at 21-26 kn, gusting
// 36, averages 22 over all its hours and 25 over its best three. Riders call
// that day very good, and the second number says so; the first does not.
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
// How many of the best hours the rating averages. A session shorter than this
// is averaged whole and earns the tier below.
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
// goodHours: rideable hours (in 2h+ runs). avgKn: mean over all of them.
// bestKn: mean over the best FULL_SESSION_HOURS of them — or over both hours
// of a 2h session — which is what the rating reads. bestHours says which.
export interface SessionStats { goodHours: number; avgKn: number; bestKn: number; bestHours: number }

// Mean of the strongest `n` hours. 0 when there are fewer than `n`.
export function topHoursAvg(good: RatedHour[], n: number): number {
  if (good.length < n || n <= 0) return 0
  const top = good.map(h => h.kn).sort((a, b) => b - a).slice(0, n)
  return top.reduce((s, k) => s + k, 0) / n
}

// Everything rateSession needs, from the qualifying hours of one day. Lone
// hours are dropped here (a lone windy hour is not a session), so callers may
// pass the raw qualifying list.
export function sessionStats(good: RatedHour[]): SessionStats {
  const run = consecutiveRuns(good, h => h.hr)
  const avgKn = run.length ? Math.round(run.reduce((s, h) => s + h.kn, 0) / run.length) : 0
  const bestHours = Math.min(run.length, FULL_SESSION_HOURS)
  return { goodHours: run.length, avgKn, bestKn: topHoursAvg(run, bestHours), bestHours }
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
  // A full session is rated on its best three hours; a 2h session on both of
  // its hours, one tier lower.
  const short = gh < FULL_SESSION_HOURS
  const t = RATING_TIERS.find(x => s.bestKn >= x.minKn)
  if (t) {
    const r = short ? RATING_TIERS.find(x => x.key === t.below)! : t
    return { tier: r.key, style: r.key, label: `✅ ${gh}h · ${r.label}` }
  }
  if (s.bestKn >= CHILL_MIN_KN) return { tier: 'chill', style: 'chill', label: `✅ ${gh}h · Chill` }
  return { tier: 'lightwind', style: 'lightwind', label: `⚡ ${gh}h · Light wind` }
}
