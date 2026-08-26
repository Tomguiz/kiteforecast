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
