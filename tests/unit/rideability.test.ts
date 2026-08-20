import { describe, it, expect } from 'vitest'
import {
  hourQualifies,
  consecutiveRuns,
  isWindDirOK,
  speedTier,
} from '../../supabase/functions/_shared/rideability.ts'

// This module is the single backend definition of "rideable", imported by
// weekly-digest, check-new-sessions and process-reminders. It must agree with
// index.html `hourQualifies` / `dayGoodHours`.

const DIRS = [0, 45, 225, 270, 315]

describe('hourQualifies', () => {
  it('counts a plain 15kn+ hour', () => {
    expect(hourQualifies(15, 270, 0, 0, DIRS)).toBe(true)
    expect(hourQualifies(30, 270, 0, 0, DIRS)).toBe(true)
  })

  it('counts a gusty sub-15kn hour', () => {
    // The clause that was missing from all three edge functions.
    expect(hourQualifies(12, 270, 0, 20, DIRS)).toBe(true)
    expect(hourQualifies(14, 270, 0, 26, DIRS)).toBe(true)
  })

  it('holds the gusty clause at its exact boundaries', () => {
    expect(hourQualifies(12, 270, 0, 20, DIRS)).toBe(true)
    expect(hourQualifies(11, 270, 0, 20, DIRS)).toBe(false) // kn below 12
    expect(hourQualifies(12, 270, 0, 19, DIRS)).toBe(false) // gust below 20
  })

  it('rejects rain regardless of wind', () => {
    expect(hourQualifies(30, 270, 61, 40, DIRS)).toBe(false)
    expect(hourQualifies(30, 270, 51, 40, DIRS)).toBe(false)
    expect(hourQualifies(30, 270, 50, 40, DIRS)).toBe(true) // 50 is not rain
  })

  it('rejects off-direction wind', () => {
    expect(hourQualifies(30, 135, 0, 40, DIRS)).toBe(false)
    expect(hourQualifies(30, 180, 0, 40, DIRS)).toBe(false)
  })

  it('treats a missing gust reading as zero rather than throwing', () => {
    expect(hourQualifies(20, 270, 0, undefined as unknown as number, DIRS)).toBe(true)
    expect(hourQualifies(13, 270, 0, undefined as unknown as number, DIRS)).toBe(false)
  })
})

describe('isWindDirOK', () => {
  it('accepts within ±30° of any listed direction', () => {
    expect(isWindDirOK(270, DIRS)).toBe(true)
    expect(isWindDirOK(292, DIRS)).toBe(true)
    expect(isWindDirOK(248, DIRS)).toBe(true)
  })

  // The reason the tolerance moved off 22.5. Riverwoods is listed [270, 315];
  // the mast 16 km out was reading 246.3° — solid WSW, a direction anyone
  // would ride there — and the old rule rejected it for being 1.2° too far.
  it('accepts the WSW that the old ±22.5° rule rejected', () => {
    expect(isWindDirOK(246.3, [270, 315])).toBe(true)
    expect(isWindDirOK(250.1, [270, 315])).toBe(true)   // what Cadzand reported
  })

  it('still refuses a direction genuinely off the spot', () => {
    expect(isWindDirOK(239, [270])).toBe(false)   // just past the 240° edge
    expect(isWindDirOK(180, [270])).toBe(false)
    expect(isWindDirOK(90,  [270, 315])).toBe(false)
  })

  it('wraps around north', () => {
    expect(isWindDirOK(350, [0])).toBe(true)
    expect(isWindDirOK(10, [0])).toBe(true)
    expect(isWindDirOK(180, [0])).toBe(false)
  })

  it('treats an empty or missing list as "any direction"', () => {
    expect(isWindDirOK(135, [])).toBe(true)
    expect(isWindDirOK(135, undefined as unknown as number[])).toBe(true)
  })
})

describe('consecutiveRuns', () => {
  const h = (hour: number) => ({ hour })

  it('drops isolated hours', () => {
    expect(consecutiveRuns([h(10), h(12), h(14)], x => x.hour)).toEqual([])
  })

  it('keeps runs of 2 or more', () => {
    expect(consecutiveRuns([h(10), h(11), h(14)], x => x.hour)).toEqual([h(10), h(11)])
  })

  it('keeps every hour of a long run', () => {
    const run = [h(9), h(10), h(11), h(12)]
    expect(consecutiveRuns(run, x => x.hour)).toEqual(run)
  })

  it('handles the empty case', () => {
    expect(consecutiveRuns([], (x: { hour: number }) => x.hour)).toEqual([])
  })
})

describe('speedTier', () => {
  it('bands at 15 / 20 / 25 kn', () => {
    expect(speedTier(14)).toBe(0)
    expect(speedTier(15)).toBe(1)
    expect(speedTier(20)).toBe(2)
    expect(speedTier(25)).toBe(3)
  })
})
