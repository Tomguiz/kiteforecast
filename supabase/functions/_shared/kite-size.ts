// Kite size suggestion.
//
// Calibrated on the rider's own reference point, not a table found online:
// 75 kg, 20 kn, intermediate -> 10 m; a beginner takes 9, an experienced
// rider 11-12. Everything below is derived from that.
//
//   size = K * weight / wind * powerFactor      K = 10 * 20 / 75 = 2.667
//
// This is advice that puts someone on the water, so it errs toward refusing
// to answer over guessing: no weight, no level, or wind outside the band and
// it returns null. A caller must render "we don't know" rather than a default.

export const KITE_SIZE_K = 2.6667

// Discrete sizes people actually own. A 9.7 m recommendation helps nobody.
export const QUIVER_SIZES = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export type RiderLevel = 'Beginner' | 'Intermediate' | 'Advanced'
export type PowerPref = 'underpowered' | 'neutral' | 'overpowered'

// Level is the dominant dial: it encodes both skill and how much power the
// rider can hold. Matches the reference numbers exactly at 75 kg / 20 kn.
const LEVEL_FACTOR: Record<RiderLevel, number> = {
  Beginner: 0.90, Intermediate: 1.00, Advanced: 1.15,
}
// Preference refines, it does not compete. Kept smaller than a level step so
// taste cannot outrank capability.
const PREF_FACTOR: Record<PowerPref, number> = {
  underpowered: 0.92, neutral: 1.00, overpowered: 1.08,
}
// Multiplying the two unbounded lets "advanced + overpowered" drift past what
// the rider described as the top of the range, so the product is clamped.
const FACTOR_MIN = 0.85, FACTOR_MAX = 1.20

// Outside this band there is no useful answer. Below it the app does not call
// the day rideable anyway; above it, kite choice stops being a formula and
// becomes a judgement about whether to go out at all.
export const MIN_WIND_KN = 14
export const MAX_WIND_KN = 40

export function powerFactor(level: RiderLevel, pref: PowerPref): number {
  const raw = LEVEL_FACTOR[level] * PREF_FACTOR[pref]
  return Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, raw))
}

export interface KiteSizeInput {
  weightKg: number | null | undefined
  level: RiderLevel | null | undefined
  pref?: PowerPref | null
  windKn: number
}

export interface KiteSizeResult { size: number; exact: number }

// null means "cannot say", never "use a default".
export function suggestKiteSize(i: KiteSizeInput): KiteSizeResult | null {
  const { weightKg, level, windKn } = i
  if (!weightKg || !level) return null
  if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 150) return null
  if (!Number.isFinite(windKn) || windKn < MIN_WIND_KN || windKn > MAX_WIND_KN) return null
  if (!(level in LEVEL_FACTOR)) return null
  const pref: PowerPref = (i.pref && i.pref in PREF_FACTOR) ? i.pref : 'neutral'
  const exact = KITE_SIZE_K * weightKg / windKn * powerFactor(level, pref)
  // Snapping only makes sense inside the quiver. An 80 kg rider who likes
  // being overpowered wants 18.3 m at 14 kn; answering "14 m" is not a
  // recommendation, it is the largest number in the list pretending to be
  // one. Outside the range there is no honest answer.
  if (exact > QUIVER_SIZES[QUIVER_SIZES.length - 1] + 1) return null
  if (exact < QUIVER_SIZES[0] - 1) return null
  const size = QUIVER_SIZES.reduce((best, s) =>
    Math.abs(s - exact) < Math.abs(best - exact) ? s : best, QUIVER_SIZES[0])
  return { size, exact: Math.round(exact * 10) / 10 }
}
