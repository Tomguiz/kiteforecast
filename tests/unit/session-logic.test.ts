import { describe, it, expect } from 'vitest'
import {
  getGoodSessions,
  goodHours,
  hourQualifies,
  isWindDirOK,
} from '../../supabase/functions/weekly-digest/session-logic.ts'

// Build a one-day Open-Meteo-shaped payload from an hour spec, so the digest's
// session detection can be pinned without hitting the network.
function wxDay(hours: Array<{ hr: number; kn: number; gust?: number; dir?: number; code?: number }>) {
  const date = '2026-08-18'
  const knToMs = (kn: number) => kn / 1.94384
  return {
    daily: { time: [date], sunrise: [`${date}T06:00`], sunset: [`${date}T21:00`] },
    hourly: {
      time:              hours.map(h => `${date}T${String(h.hr).padStart(2, '0')}:00`),
      windspeed_10m:     hours.map(h => knToMs(h.kn)),
      windgusts_10m:     hours.map(h => knToMs(h.gust ?? 0)),
      winddirection_10m: hours.map(h => h.dir ?? 270),
      weather_code:      hours.map(h => h.code ?? 0),
    },
  }
}

const SPOT_DIRS = [0, 45, 225, 270, 315]

describe('hourQualifies — matches index.html', () => {
  it('counts a gusty sub-15kn hour (kn>=12 && gust>=20)', () => {
    // Regression: the digest used to require speedTier>0 only, so gusty days
    // the app showed as rideable were mailed out as "No sessions this week".
    expect(hourQualifies(13, 270, 0, 22, SPOT_DIRS)).toBe(true)
  })

  it('rejects a sub-15kn hour without the gusts to back it up', () => {
    expect(hourQualifies(13, 270, 0, 18, SPOT_DIRS)).toBe(false)
    expect(hourQualifies(11, 270, 0, 25, SPOT_DIRS)).toBe(false)
  })

  it('still counts a plain 15kn+ hour', () => {
    expect(hourQualifies(17, 270, 0, 0, SPOT_DIRS)).toBe(true)
  })

  it('rejects rain and off-direction hours', () => {
    expect(hourQualifies(20, 270, 61, 0, SPOT_DIRS)).toBe(false)
    expect(hourQualifies(20, 135, 0, 0, SPOT_DIRS)).toBe(false)
  })
})

describe('goodHours — 2+ consecutive run required', () => {
  it('drops isolated qualifying hours', () => {
    const hours = [
      { hr: 10, kn: 20, gust: 25, dir: 270, code: 0 },
      { hr: 11, kn: 5,  gust: 6,  dir: 270, code: 0 },
      { hr: 12, kn: 20, gust: 25, dir: 270, code: 0 },
    ]
    expect(goodHours(hours, SPOT_DIRS)).toHaveLength(0)
  })

  it('keeps a consecutive run', () => {
    const hours = [
      { hr: 10, kn: 20, gust: 25, dir: 270, code: 0 },
      { hr: 11, kn: 20, gust: 25, dir: 270, code: 0 },
    ]
    expect(goodHours(hours, SPOT_DIRS)).toHaveLength(2)
  })
})

describe('getGoodSessions', () => {
  it('reports a session for a gusty day the app calls rideable', () => {
    // Oostduinkerke, 2026-08-18: ~14kn gusting 25 — rideable in the app.
    const wx = wxDay([
      { hr: 12, kn: 13, gust: 24 },
      { hr: 13, kn: 14, gust: 25 },
      { hr: 14, kn: 14, gust: 25 },
    ])
    const sessions = getGoodSessions(wx, SPOT_DIRS, null)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].duration_hours).toBe(3)
    expect(sessions[0].win_start).toBe('12h00')
    expect(sessions[0].win_end).toBe('15h00')
  })

  it('does not report a day whose only qualifying hours are scattered', () => {
    const wx = wxDay([
      { hr: 10, kn: 20 },
      { hr: 11, kn: 4 },
      { hr: 12, kn: 20 },
    ])
    expect(getGoodSessions(wx, SPOT_DIRS, null)).toHaveLength(0)
  })

  it('ignores hours outside daylight', () => {
    const wx = wxDay([
      { hr: 2, kn: 25, gust: 30 },
      { hr: 3, kn: 25, gust: 30 },
    ])
    expect(getGoodSessions(wx, SPOT_DIRS, null)).toHaveLength(0)
  })

  it('honours spot_days filtering', () => {
    // 2026-08-18 is a Tuesday (dow 2).
    const wx = wxDay([{ hr: 12, kn: 20 }, { hr: 13, kn: 20 }])
    expect(getGoodSessions(wx, SPOT_DIRS, [2])).toHaveLength(1)
    expect(getGoodSessions(wx, SPOT_DIRS, [3])).toHaveLength(0)
  })

  it('averages and summarises only the good hours', () => {
    const wx = wxDay([
      { hr: 12, kn: 16, gust: 22, dir: 270 },
      { hr: 13, kn: 20, gust: 28, dir: 270 },
      { hr: 20, kn: 30, gust: 40, dir: 270 }, // isolated — must not skew avg/gust
    ])
    const [sess] = getGoodSessions(wx, SPOT_DIRS, null)
    expect(sess.duration_hours).toBe(2)
    expect(sess.avg_kn).toBe(18)
    expect(sess.max_gust).toBe(28)
    expect(sess.dom_dir).toBe('W')
  })
})

describe('isWindDirOK — the stale-dirs regression', () => {
  it('accepts NE wind for a spot whose overrides include NE', () => {
    // Production was filtering on the stale favourites snapshot [270,315],
    // which rejected every hour at spots whose real dirs include N/NE/SW.
    expect(isWindDirOK(45, SPOT_DIRS)).toBe(true)
    expect(isWindDirOK(45, [270, 315])).toBe(false)
  })

  it('treats an empty dirs list as "any direction"', () => {
    expect(isWindDirOK(135, [])).toBe(true)
  })
})
