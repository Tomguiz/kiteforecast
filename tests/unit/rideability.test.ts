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
  it('accepts within ±20° of any listed direction', () => {
    expect(isWindDirOK(270, DIRS)).toBe(true)
    expect(isWindDirOK(289, DIRS)).toBe(true)
    expect(isWindDirOK(252, DIRS)).toBe(true)
  })

  // The Knokke floor, from the rider who sails there: Riverwoods, Het Zoute
  // and Surfers Paradise need 250° or more. ±20 off a listed W puts the floor
  // exactly there, which is why the tolerance is 20 and not 22.5 or 30.
  it('puts the floor on 250° for a spot listed W', () => {
    expect(isWindDirOK(250.1, [270, 315])).toBe(true)
    expect(isWindDirOK(249, [270, 315])).toBe(false)
    expect(isWindDirOK(246.3, [270, 315])).toBe(false)
  })

  it('still refuses a direction genuinely off the spot', () => {
    expect(isWindDirOK(249, [270])).toBe(false)   // just past the 250° edge
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

// ── Day rating ──────────────────────────────────────────────────────────────
import {
  topHoursAvg, sessionStats, rateSession, RATING_TIERS, RATING_STYLE, CHILL_MIN_KN,
} from '../../supabase/functions/_shared/rideability.ts'

// hours 10:00.. at the given speeds, gusting a little over each
const run = (...kns: number[]) => kns.map((kn, i) => ({ hr: 10 + i, kn, gustKn: kn + 3 }))
const rate = (kns: number[], code = 0, badDir = false, peakDay = 0) =>
  rateSession(sessionStats(run(...kns)), code, badDir, peakDay)
// the same hours with one gust figure across them
const rateGusty = (kns: number[], gustKn: number) =>
  rateSession(sessionStats(kns.map((kn, i) => ({ hr: 10 + i, kn, gustKn }))), 0, false, 0)

describe('topHoursAvg', () => {
  it('is the mean of the strongest n hours, wherever they sit in the day', () => {
    expect(topHoursAvg(run(20, 30, 40), 3)).toBe(30)
    // 15,16,17 then 30,31,32: the afternoon carries the day
    expect(topHoursAvg(run(15, 16, 17, 30, 31, 32), 3)).toBe(31)
    // the best hours need not be back to back
    expect(topHoursAvg(run(26, 15, 25, 15, 24), 3)).toBe(25)
  })

  it('is 0 when there are fewer than n hours', () => {
    expect(topHoursAvg(run(30, 30), 3)).toBe(0)
    expect(topHoursAvg([], 2)).toBe(0)
  })
})

describe('sessionStats', () => {
  it('drops lone hours before averaging — a lone windy hour is not a session', () => {
    const s = sessionStats([{ hr: 9, kn: 40 }, { hr: 12, kn: 16 }, { hr: 13, kn: 18 }])
    expect(s.goodHours).toBe(2)
    expect(s.avgKn).toBe(17)
    expect(s.bestHours).toBe(2)     // a 2h session is rated on both hours
    expect(s.bestKn).toBe(17)
  })

  it('reads the best three hours of a full session, for wind and for gusts', () => {
    const s = sessionStats(run(18, 21, 21, 24, 26, 25))
    expect(s.goodHours).toBe(6)
    expect(s.avgKn).toBe(23)
    expect(s.bestHours).toBe(3)
    expect(s.bestKn).toBe(25)
    expect(s.bestGustKn).toBe(28)   // run() gusts kn+3
  })

  it('treats a missing gust as no gust', () => {
    expect(sessionStats([{ hr: 10, kn: 20 }, { hr: 11, kn: 20 }]).bestGustKn).toBe(0)
  })

  it('rounds the whole-session average to whole knots', () => {
    expect(sessionStats(run(20, 21, 21)).avgKn).toBe(21)
  })
})

describe('rateSession — the expert scale', () => {
  it('names the tiers in descending order, 35 / 30 / 25 / 18', () => {
    expect(RATING_TIERS.map(t => [t.key, t.minKn])).toEqual([
      ['expert', 35], ['epic', 30], ['verygood', 25], ['good', 18],
    ])
    expect(CHILL_MIN_KN).toBe(14)
  })

  it('Expert mode: 35+ kn avg over 3h+', () => {
    expect(rate([35, 35, 35])).toMatchObject({ tier: 'expert', label: '✅ 3h · Expert mode' })
    expect(rate([34, 34, 34])).toMatchObject({ tier: 'epic' })
  })
  it('… and the same wind over only 2h is Epic', () => {
    expect(rate([40, 40])).toMatchObject({ tier: 'epic', label: '✅ 2h · Epic' })
  })

  it('Epic: 30+ kn avg over 3h+', () => {
    expect(rate([30, 30, 30, 30])).toMatchObject({ tier: 'epic', label: '✅ 4h · Epic' })
  })
  it('… and 2h at 30+ is Very Good', () => {
    expect(rate([30, 30])).toMatchObject({ tier: 'verygood', label: '✅ 2h · Very Good' })
  })

  it('Very Good: 25+ kn avg over 3h+', () => {
    expect(rate([25, 25, 25])).toMatchObject({ tier: 'verygood' })
  })
  it('… and 2h at 25+ is Good', () => {
    expect(rate([25, 26])).toMatchObject({ tier: 'good', label: '✅ 2h · Good' })
  })

  it('Good: 18+ kn avg, 2h or 3h alike', () => {
    expect(rate([18, 18, 18])).toMatchObject({ tier: 'good' })
    expect(rate([18, 19])).toMatchObject({ tier: 'good' })
  })

  it('Chill: a 14-18 kn average, however long the window', () => {
    expect(rate([15, 16, 17, 16])).toMatchObject({ tier: 'chill', label: '✅ 4h · Chill' })
    expect(rate([16, 17])).toMatchObject({ tier: 'chill', label: '✅ 2h · Chill' })
    expect(rate([14, 14, 14])).toMatchObject({ tier: 'chill' })
    expect(rate([13, 14, 14])).toMatchObject({ tier: 'lightwind' })
  })

  it('rates the average, so one strong hour does not make an epic day', () => {
    // peak 34 — the old rule would have called this Perfect. The best 2h
    // window averages 25, which is a Good day, not an epic one.
    expect(rate([16, 16, 34, 16, 16])).toMatchObject({ tier: 'good' })
  })

  it('rates the best hours, so a light morning does not hide an epic afternoon', () => {
    // whole-day average is 24; the best three hours average 31
    expect(rate([15, 16, 17, 30, 31, 32])).toMatchObject({ tier: 'epic', label: '✅ 6h · Epic' })
  })

  it('a long day at 21-26 kn is Very Good, not merely Good', () => {
    // The day that prompted the rule: 09-11 at 21/21/24, an hour lost to
    // direction, then 13-14 at 26/25. No three consecutive hours average 25,
    // but the best three of the day do — and a rider has the whole day.
    const hours = [[8, 18], [9, 21], [10, 21], [11, 24], [13, 26], [14, 25]].map(([hr, kn]) => ({ hr, kn }))
    const s = sessionStats(hours)
    expect(s.goodHours).toBe(6)
    expect(rateSession(s, 3, false, 26)).toMatchObject({ tier: 'verygood', label: '✅ 6h · Very Good' })
  })

  describe('gusts reach the tiers too', () => {
    it('Expert mode from gusts 40+, Epic from 37+, Very Good from 30+; Good has no gust rung', () => {
      expect(RATING_TIERS.map(t => [t.key, t.minGustKn])).toEqual([
        ['expert', 40], ['epic', 37], ['verygood', 30], ['good', Infinity],
      ])
      expect(rateGusty([20, 20, 20], 41)).toMatchObject({ tier: 'expert' })
      expect(rateGusty([20, 20, 20], 38)).toMatchObject({ tier: 'epic' })
      expect(rateGusty([20, 20, 20], 36)).toMatchObject({ tier: 'verygood' })   // 36 is short of Epic's 37
      expect(rateGusty([20, 20, 20], 31)).toMatchObject({ tier: 'verygood' })
      expect(rateGusty([16, 16, 16], 28)).toMatchObject({ tier: 'chill' })      // gusts do not make a Good day
    })

    it('the higher of wind and gusts wins, never the lower', () => {
      expect(rateGusty([31, 31, 31], 33)).toMatchObject({ tier: 'epic' })       // wind says epic, gusts only very good
      expect(rateGusty([20, 20, 20], 29)).toMatchObject({ tier: 'good' })       // gusts under 30 change nothing
    })

    it('a 2h session still lands one tier lower', () => {
      expect(rateGusty([20, 20], 38)).toMatchObject({ tier: 'verygood', label: '✅ 2h · Very Good' })
    })

    it('do not lift a light-wind day — that is the gust rule already, not a session', () => {
      expect(rateGusty([13, 13, 13], 32)).toMatchObject({ tier: 'lightwind' })
    })

    it('the same Sycod day, with its 30-36 kn gusts, stays Very Good', () => {
      const hours = [[8, 18, 26], [9, 21, 30], [10, 21, 30], [11, 24, 33], [13, 26, 36], [14, 25, 36]]
        .map(([hr, kn, gustKn]) => ({ hr, kn, gustKn }))
      expect(rateSession(sessionStats(hours), 3, false, 26)).toMatchObject({ tier: 'verygood' })
    })

    it('a 22 kn day gusting 30-34 all day is Very Good, not Good', () => {
      // Sep 4: 07-13 at 22/22/22/20/23/23/25 gusting 30-34, 14h lost to a
      // shower, then 22/21/19/16/17/17. Wind alone averages 24 over the best
      // three hours; the gusts carry it over the Very Good rung.
      const kn = [22, 22, 22, 20, 23, 23, 25, null, 22, 21, 19, 16, 17, 17]
      const gust = [30, 30, 31, 29, 33, 33, 34, 36, 33, 30, 28, 25, 22, 23]
      const hours = kn.flatMap((k, i) => k === null ? [] : [{ hr: 7 + i, kn: k, gustKn: gust[i] }])
      expect(rateSession(sessionStats(hours), 3, false, 25)).toMatchObject({ tier: 'verygood', label: '✅ 13h · Very Good' })
    })
  })

  it('a session below 15 kn can only be a gust-rule day: light wind, not sold as a session', () => {
    expect(rate([13, 13, 14])).toMatchObject({ tier: 'lightwind', label: '⚡ 3h · Light wind' })
  })

  it('every session tier carries the ✅ the templates and the OFF rule key on', () => {
    for (const kns of [[40, 40, 40], [30, 30, 30], [25, 25, 25], [18, 18, 18], [16, 16, 16], [20, 20]])
      expect(rate(kns).label.startsWith('✅')).toBe(true)
    expect(rate([13, 13]).label.startsWith('✅')).toBe(false)
  })

  it('a storm code trumps everything', () => {
    expect(rate([40, 40, 40], 95)).toMatchObject({ tier: 'storm', style: 'danger', label: '❌ Storm ⚡' })
  })

  it('explains an empty day: rain, snow, direction, too light, no wind', () => {
    expect(rate([], 61, false, 20)).toMatchObject({ tier: 'rain', label: '❌ 🌧 Rain' })
    expect(rate([], 73, false, 20)).toMatchObject({ tier: 'snow', label: '❌ ❄️ Snow' })
    expect(rate([], 0, true, 20)).toMatchObject({ tier: 'wrongdir', label: '❌ Wrong direction' })
    expect(rate([], 0, false, 12)).toMatchObject({ tier: 'toolight', label: '❌ Too light' })
    expect(rate([], 0, false, 5)).toMatchObject({ tier: 'nowind', label: '❌ No wind' })
  })

  it('a lone hour is not a session', () => {
    // sessionStats already drops it, so this reads as "no wind" at the day level
    expect(rate([40], 0, false, 40).label.startsWith('❌')).toBe(true)
    expect(rateSession({ goodHours: 1, avgKn: 40, bestKn: 40, bestGustKn: 45, bestHours: 1 }, 0, false, 40))
      .toMatchObject({ tier: 'brief', label: '❌ Too brief (1h)' })
  })

  it('every style a rating can name has colours', () => {
    const styles = new Set<string>()
    for (const kns of [[40, 40, 40], [30, 30, 30], [25, 25, 25], [18, 18, 18], [16, 16], [13, 13]])
      styles.add(rate(kns).style)
    styles.add(rate([], 95).style)
    styles.add(rate([], 61, false, 20).style)
    styles.add(rate([], 0, false, 5).style)
    for (const s of styles) expect(RATING_STYLE[s], s).toBeDefined()
  })

  it('gets hotter as the wind gets stronger: red at the top, green at the bottom', () => {
    // The pill's ink is what a rider reads; each tier gets its own.
    const fg = ['expert', 'epic', 'verygood', 'good', 'chill'].map(k => RATING_STYLE[k].fg)
    expect(new Set(fg).size).toBe(fg.length)
    expect(RATING_STYLE.expert.bg).toMatch(/^rgba\(239,68,68/)   // red
    expect(RATING_STYLE.epic.bg).toMatch(/^rgba\(249,115,22/)    // orange
    expect(RATING_STYLE.verygood.bg).toMatch(/^rgba\(234,179,8/) // yellow
    expect(RATING_STYLE.good.bg).toMatch(/^rgba\(34,197,94/)     // green
  })
})
