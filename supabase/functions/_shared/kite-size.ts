// Kite size suggestion, as bands rather than a curve.
//
// The first version fitted size = K * weight / wind. It was calibrated on one
// point and it was wrong, because that is not how anyone rides: an inverse law
// wants 18.3 m at 14 kn and 11.6 m at 22 kn, while the rider it was built for
// holds a single 12 m across that whole range. No amount of smoothing rescues
// a curve that moves 6.6 m over a range where the rider does not move at all.
//
// So the model is his actual quiver. Reference rider — 80 kg, Advanced,
// overpowered:
//
//     12 m   14 - 22 kn
//     10 m   22 - 32 kn
//      8 m   32 kn and up
//
// Everyone else is that, scaled. Bands also make the hour-by-hour column
// stable for free: inside a band the answer cannot flicker, which is what the
// hysteresis in the previous version existed to fake.

export type RiderLevel = 'Beginner' | 'Intermediate' | 'Advanced'
export type PowerPref = 'underpowered' | 'neutral' | 'overpowered'

export const QUIVER_SIZES = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
// Matches the app's own rideable floor (hourQualifies: 15 kn, or 12 with
// gusts >= 20). A row the app calls rideable must never show a blank size —
// the two rules disagreeing is what made the column say nothing on hours the
// rest of the card had already marked as a session.
export const MIN_WIND_KN = 12
export const MAX_WIND_KN = 45

// Upper bound of each band, and the size the reference rider flies in it.
export const WIND_BANDS: ReadonlyArray<{ maxKn: number; refSize: number }> = [
  { maxKn: 22, refSize: 12 },
  { maxKn: 32, refSize: 10 },
  { maxKn: Infinity, refSize: 8 },
]
export const REF_WEIGHT_KG = 80

// Relative to the reference (Advanced). Calibrated on the rider's own quiver
// at 80 kg on the 14-22 kn band: he flies 12 m, a beginner 10-11 m. That is a
// ratio of ~0.88, not the ~0.78 implied by his earlier off-the-cuff estimate
// of 9/10/11.5 — the quiver numbers win, being what he actually rides.
const LEVEL_REL: Record<RiderLevel, number> = {
  Beginner: 0.87, Intermediate: 0.94, Advanced: 1.00,
}
// Relative to the reference (overpowered). Smaller than a level step, so
// taste refines capability instead of competing with it.
const PREF_REL: Record<PowerPref, number> = {
  underpowered: 0.90, neutral: 0.95, overpowered: 1.00,
}

// A normal gust sits around 1.3x the average. Only the excess beyond that
// counts, and only partly: 14 kn gusting 29 is not a 14 kn session, but 20
// gusting 26 IS an ordinary 20 and must not be inflated — otherwise every
// reference in the band table shifts.
export const GUST_NORMAL_RATIO = 1.3
export const GUST_EXCESS_WEIGHT = 0.8

export function effectiveWindKn(windKn: number, gustKn?: number | null): number {
  if (!gustKn || !Number.isFinite(gustKn)) return windKn
  const normal = windKn * GUST_NORMAL_RATIO
  return gustKn > normal ? windKn + GUST_EXCESS_WEIGHT * (gustKn - normal) : windKn
}

export interface KiteSizeInput {
  weightKg: number | null | undefined
  level: RiderLevel | null | undefined
  pref?: PowerPref | null
  windKn: number
  gustKn?: number | null
}
export interface KiteSizeResult {
  size: number
  exact: number
  limit: 'over' | 'under' | null
  bandMaxKn: number      // lets the UI say "up to 22 kn" instead of repeating a number
}

export function riderScale(weightKg: number, level: RiderLevel, pref: PowerPref): number {
  return (weightKg / REF_WEIGHT_KG) * LEVEL_REL[level] * PREF_REL[pref]
}

// null means "cannot say". Never a default body weight: this advice puts a
// person on the water.
export function suggestKiteSize(i: KiteSizeInput): KiteSizeResult | null {
  const { weightKg, level, windKn } = i
  if (!weightKg || !level) return null
  if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 150) return null
  if (!Number.isFinite(windKn) || windKn < MIN_WIND_KN || windKn > MAX_WIND_KN) return null
  if (!(level in LEVEL_REL)) return null
  const pref: PowerPref = (i.pref && i.pref in PREF_REL) ? i.pref : 'neutral'

  const eff = effectiveWindKn(windKn, i.gustKn)
  const band = WIND_BANDS.find(b => eff <= b.maxKn)!
  const exact = band.refSize * riderScale(weightKg, level, pref)

  const MAXS = QUIVER_SIZES[QUIVER_SIZES.length - 1], MINS = QUIVER_SIZES[0]
  const round1 = (x: number) => Math.round(x * 10) / 10
  if (exact > MAXS) return { size: MAXS, exact: round1(exact), limit: 'over', bandMaxKn: band.maxKn }
  if (exact < MINS) return { size: MINS, exact: round1(exact), limit: 'under', bandMaxKn: band.maxKn }
  const size = QUIVER_SIZES.reduce((best, s) =>
    Math.abs(s - exact) < Math.abs(best - exact) ? s : best, QUIVER_SIZES[0])
  return { size, exact: round1(exact), limit: null, bandMaxKn: band.maxKn }
}
