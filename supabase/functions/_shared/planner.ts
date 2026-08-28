// Session planner: "where should I drive to ride, in the next few days?"
//
// The search is bounded on purpose. J..J+3 only, because the rider's own
// answer to why: beyond that the forecast is not reliable enough to plan a
// drive on. Car only. And the candidate list is cut geographically BEFORE any
// forecast is fetched — 399 spots is 399 requests, which is not a search, it
// is a denial of service against Open-Meteo.

import { haversineKm } from './nearby.ts'

export const MAX_PLAN_DAYS = 4          // today + 3
export const DEFAULT_MAX_DRIVE_MIN = 180
export const DEFAULT_MIN_WIND_KN = 15
// Straight-line radius used to shortlist before routing. Roads are never
// shorter than the crow flies, so anything beyond this cannot come back inside
// the drive budget — 90 km/h is generous for a motorway average.
export const KM_PER_DRIVE_HOUR = 90
export const MAX_CANDIDATES = 14        // forecast requests, so a real cost

export interface PlannerSpot {
  name: string; loc?: string; lat: number; lon: number; dirs?: number[]
  waterType?: string | null
}
export interface Candidate extends PlannerSpot { distanceKm: number; driveMin?: number }

// Shortlist by straight-line distance, spread so the list is not six beaches
// on the same 10 km of coast — the rider wants options, not neighbours.
export function shortlistCandidates(
  spots: PlannerSpot[],
  home: { lat: number; lon: number },
  opts: { maxDriveMin: number; minSeparationKm: number; limit?: number; waterType?: string | null },
): Candidate[] {
  const radiusKm = (opts.maxDriveMin / 60) * KM_PER_DRIVE_HOUR
  const style = opts.waterType?.toLowerCase()
  const kept: Candidate[] = []
  const inRange = spots
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .filter(s => !style || (s.waterType || '').toLowerCase().includes(style))
    .map(s => ({ ...s, distanceKm: haversineKm(home.lat, home.lon, s.lat, s.lon) }))
    .filter(s => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
  for (const s of inRange) {
    if (kept.length >= (opts.limit ?? MAX_CANDIDATES)) break
    if (kept.some(k => haversineKm(k.lat, k.lon, s.lat, s.lon) < opts.minSeparationKm)) continue
    kept.push(s)
  }
  return kept
}

export interface PlannedDay {
  dateStr: string; goodHours: number; peakKn: number; startHr: number | null; dir: string | null
}
export interface PlannedSpot extends Candidate { days: PlannedDay[] }

export type PlanSort = 'best' | 'wind' | 'near'

// Ranks whole SPOTS, each carrying its rideable days. A spot with no day that
// clears the wind floor is dropped entirely — an option you would not drive to
// is not an option.
export function rankPlan(
  spots: PlannedSpot[], opts: { minWindKn: number; sort: PlanSort; maxDriveMin?: number },
): PlannedSpot[] {
  const usable = spots
    .map(s => ({ ...s, days: s.days.filter(d => d.goodHours >= 2 && d.peakKn >= opts.minWindKn) }))
    .filter(s => s.days.length > 0)
    .filter(s => opts.maxDriveMin == null || s.driveMin == null || s.driveMin <= opts.maxDriveMin)

  const peak = (s: PlannedSpot) => Math.max(...s.days.map(d => d.peakKn))
  const hours = (s: PlannedSpot) => Math.max(...s.days.map(d => d.goodHours))
  const drive = (s: PlannedSpot) => s.driveMin ?? Infinity

  if (opts.sort === 'wind') usable.sort((a, b) => peak(b) - peak(a) || drive(a) - drive(b))
  else if (opts.sort === 'near') usable.sort((a, b) => drive(a) - drive(b) || peak(b) - peak(a))
  else {
    // "Best" is not "windiest": an hour more of driving has to buy something.
    // Score trades peak and session length against time in the car.
    const score = (s: PlannedSpot) => peak(s) + hours(s) * 1.5 - (drive(s) / 60) * 6
    usable.sort((a, b) => score(b) - score(a))
  }
  return usable
}

// The dates the search covers. Kept here rather than inline so the bound is
// one thing, testable, instead of an off-by-one waiting to happen.
export function planDates(todayISO: string, days = MAX_PLAN_DAYS): string[] {
  const out: string[] = []
  const d = new Date(todayISO + 'T12:00:00Z')
  for (let i = 0; i < Math.min(days, MAX_PLAN_DAYS); i++) {
    out.push(new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10))
  }
  return out
}
