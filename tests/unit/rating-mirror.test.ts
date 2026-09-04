import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  RATING_TIERS, RATING_STYLE, CHILL_MIN_KN, FULL_SESSION_HOURS,
  topHoursAvg, sessionStats, rateSession, isRainy, isSnowy,
} from '../../supabase/functions/_shared/rideability.ts'

// index.html is a plain script and cannot import the shared module, so the
// day rating exists twice — the same bargain the kite-size model makes. The
// app's copy sits between two markers; this evaluates it and runs both copies
// over the same inputs. Change one, this fails until you change the other.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

function appRating() {
  const start = html.indexOf('// ── DAY RATING ──')
  const end = html.indexOf('// ── END DAY RATING ──')
  if (start < 0 || end < 0) throw new Error('DAY RATING markers missing from index.html')
  const block = html.slice(start, end)
  const factory = new Function('isRainy', 'isSnowy',
    `${block}\nreturn { RATING_TIERS, CHILL_MIN_KN, FULL_SESSION_HOURS, topHoursAvg, sessionStats, rateSession };`)
  return factory(isRainy, isSnowy) as {
    RATING_TIERS: typeof RATING_TIERS; CHILL_MIN_KN: number; FULL_SESSION_HOURS: number;
    topHoursAvg: typeof topHoursAvg; sessionStats: typeof sessionStats; rateSession: typeof rateSession
  }
}

// Deterministic days so a failure reproduces: an LCG, not Math.random.
function* days(seed: number, n: number) {
  let x = seed >>> 0
  const rnd = () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32
  for (let i = 0; i < n; i++) {
    const hours: { hr: number; kn: number; gustKn: number }[] = []
    const base = 8 + Math.floor(rnd() * 4)
    const len = Math.floor(rnd() * 9)
    for (let h = 0; h < len; h++) {
      if (rnd() < 0.15) continue                     // leave gaps in the clock
      const kn = 12 + Math.floor(rnd() * 34)
      hours.push({ hr: base + h, kn, gustKn: kn + Math.floor(rnd() * 16) })
    }
    const code = [0, 1, 3, 61, 73, 95][Math.floor(rnd() * 6)]
    yield { hours, code, badDir: rnd() < 0.3, peakDay: Math.floor(rnd() * 45) }
  }
}

describe('the two copies of the day rating agree', () => {
  const app = appRating()

  it('same tiers, floor and session length', () => {
    expect(app.RATING_TIERS).toEqual(RATING_TIERS)
    expect(app.CHILL_MIN_KN).toBe(CHILL_MIN_KN)
    expect(app.FULL_SESSION_HOURS).toBe(FULL_SESSION_HOURS)
  })

  it('same rating for the same day, across a thousand days', () => {
    let sessions = 0
    for (const d of days(7, 1000)) {
      const ours = rateSession(sessionStats(d.hours), d.code, d.badDir, d.peakDay)
      const theirs = app.rateSession(app.sessionStats(d.hours), d.code, d.badDir, d.peakDay)
      expect(theirs, JSON.stringify(d)).toEqual(ours)
      if (ours.label.startsWith('✅')) sessions++
    }
    expect(sessions).toBeGreaterThan(100)   // the sample actually exercises the tiers
  })

  it('same best-hours average', () => {
    for (const d of days(11, 300))
      for (const n of [2, 3]) {
        expect(app.topHoursAvg(d.hours, n)).toBe(topHoursAvg(d.hours, n))
        expect(app.topHoursAvg(d.hours, n, 'gustKn')).toBe(topHoursAvg(d.hours, n, 'gustKn'))
      }
  })

  it('the app paints every style with the colours the emails receive', () => {
    for (const [key, c] of Object.entries(RATING_STYLE)) {
      const rule = html.match(new RegExp(`\\.rating-${key}\\s*\\{([^}]*)\\}`))
      expect(rule, `.rating-${key} rule`).toBeTruthy()
      expect(rule![1]).toContain(`background:${c.bg}`)
      expect(rule![1]).toContain(`color:${c.fg}`)
      expect(rule![1]).toContain(`border:1px solid ${c.border}`)
    }
  })

  it('the hourly Conditions pills wear the same tier colours', () => {
    for (const key of [...RATING_TIERS.map(t => t.key), 'chill', 'lightwind']) {
      const c = RATING_STYLE[key]
      const rule = html.match(new RegExp(`\\.cond-${key}\\s*\\{([^}]*)\\}`))
      expect(rule, `.cond-${key} rule`).toBeTruthy()
      expect(rule![1]).toContain(`background:${c.bg}`)
      expect(rule![1]).toContain(`color:${c.fg}`)
      expect(rule![1]).toContain(`border:1px solid ${c.border}`)
    }
    // and the hour labels come from the same tier table, not a second list
    const fn = html.slice(html.indexOf('function conditionLabel'), html.indexOf('// ── DAY RATING ──'))
    expect(fn).toContain('RATING_TIERS.find(')
    expect(fn).not.toMatch(/Perfect|Very good/)
  })

  it('the legend describes the tiers the rule actually uses', () => {
    const legend = html.slice(html.indexOf('<div class="legend-sub">Day rating'), html.indexOf('Wind speed (bar color)'))
    for (const t of RATING_TIERS) {
      expect(legend).toContain(`>${t.label}<`)
      expect(legend).toContain(`${t.minKn}+ kn avg`)
    }
    expect(legend).toContain('>Chill<')
    expect(legend).not.toMatch(/Perfect|Marginal/)
  })
})
