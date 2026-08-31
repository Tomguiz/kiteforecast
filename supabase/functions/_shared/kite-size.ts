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

// `limit` is what stops this being either a lie or a shrug. 'over' means the
// rider needs more kite than the quiver holds — take the biggest and expect it
// to be marginal. 'under' is the mirror. The UI renders these as 14 m+ / 5 m-.
export interface KiteSizeResult { size: number; exact: number; limit: 'over' | 'under' | null }

// null means "cannot say", never "use a default".
export function suggestKiteSize(i: KiteSizeInput): KiteSizeResult | null {
  const { weightKg, level, windKn } = i
  if (!weightKg || !level) return null
  if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 150) return null
  if (!Number.isFinite(windKn) || windKn < MIN_WIND_KN || windKn > MAX_WIND_KN) return null
  if (!(level in LEVEL_FACTOR)) return null
  const pref: PowerPref = (i.pref && i.pref in PREF_FACTOR) ? i.pref : 'neutral'
  const exact = KITE_SIZE_K * weightKg / windKn * powerFactor(level, pref)
  // An 80 kg rider who likes being overpowered computes 17.1 m at 15 kn.
  // Snapping that silently to 14 is a lie; returning nothing is a shrug, and
  // it removes the number the rider opened the card for. So it caps, and says
  // that it capped.
  const MAXS = QUIVER_SIZES[QUIVER_SIZES.length - 1], MINS = QUIVER_SIZES[0]
  if (exact > MAXS) return { size: MAXS, exact: Math.round(exact * 10) / 10, limit: 'over' }
  if (exact < MINS) return { size: MINS, exact: Math.round(exact * 10) / 10, limit: 'under' }
  const size = QUIVER_SIZES.reduce((best, s) =>
    Math.abs(s - exact) < Math.abs(best - exact) ? s : best, QUIVER_SIZES[0])
  return { size, exact: Math.round(exact * 10) / 10, limit: null }
}

// How far the wind may drift before the advice changes size. Without this the
// hour-by-hour column flickers 13/12/13/12 across a couple of knots, which is
// noise dressed as advice — a rider does not land to swap kite because the
// forecast moved 1 kn. Only a real shift earns a change.
export const SIZE_HYSTERESIS_M = 1.5

export interface HourWind { hr: number; kn: number }
export interface HourSize { hr: number; size: number; limit: 'over' | 'under' | null }

// Walks the hours in order and holds the current size until the requirement
// leaves a band around it. Sequential on purpose: the answer for an hour
// depends on what the rider is already flying, not only on that hour's wind.
export function smoothKiteSizes(
  hours: HourWind[], base: Omit<KiteSizeInput, 'windKn'>,
): HourSize[] {
  const out: HourSize[] = []
  let held: KiteSizeResult | null = null
  for (const h of hours) {
    const raw = suggestKiteSize({ ...base, windKn: h.kn })
    if (!raw) { held = null; continue }          // gap in the day resets the hold
    if (held && Math.abs(raw.exact - held.size) <= SIZE_HYSTERESIS_M) {
      out.push({ hr: h.hr, size: held.size, limit: raw.limit })
      continue
    }
    held = raw
    out.push({ hr: h.hr, size: raw.size, limit: raw.limit })
  }
  return out
}
