// Session detection for the weekly digest.
//
// The rideability rule itself lives in ../_shared/rideability.ts so the digest,
// check-new-sessions and process-reminders can never disagree again. This file
// is the digest-specific part: turning a forecast into mailable sessions.

import {
  hourQualifies, consecutiveRuns, toKnots, isRainy, speedTier, angleDiff, isWindDirOK,
} from '../_shared/rideability.ts'

export { hourQualifies, consecutiveRuns, toKnots, isRainy, speedTier, angleDiff, isWindDirOK }

const DIRS8   = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const ARROWS8 = ['\u2193', '\u2199', '\u2190', '\u2196', '\u2191', '\u2197', '\u2192', '\u2198']
export const compass  = (deg: number) => DIRS8[Math.round(((deg % 360) + 360) % 360 / 45) % 8]
export const dirArrow = (deg: number) => ARROWS8[Math.round(((deg % 360) + 360) % 360 / 45) % 8]

export async function fetchForecast(lat: number, lon: number) {
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: 'weather_code,windspeed_10m,windgusts_10m,winddirection_10m',
    daily: 'sunrise,sunset',
    forecast_days: '7', timezone: 'auto', windspeed_unit: 'ms',
  })
  const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  const wx = await resp.json()
  if (wx.error) throw new Error(wx.reason)
  return wx
}

export interface Hour { hr: number; kn: number; gust: number; dir: number; code: number }

// Mirrors index.html `dayGoodHours`: only qualifying hours that sit in a run of
// 2+ consecutive clock hours count. A lone qualifying hour is not a session.
export function goodHours(hours: Hour[], spotDirs: number[]): Hour[] {
  return consecutiveRuns(hours.filter(h => hourQualifies(h.kn, h.dir, h.code, h.gust, spotDirs)), h => h.hr)
}

export interface Session {
  date: string
  date_label: string
  day_of_week: string
  start_time: string
  duration_hours: number
  avg_kn: number
  max_gust: number
  dom_dir: string
  dir_arrow: string
  win_start: string
  win_end: string
  win_hours: number
}

// Daylight hours of one forecast day, in clock order.
export function dayHours(wx: any, dayIndex: number): Hour[] {
  const { daily, hourly } = wx
  const dateStr = daily.time[dayIndex]
  const srH = parseInt(daily.sunrise[dayIndex].slice(11, 13), 10)
  const ssH = parseInt(daily.sunset[dayIndex].slice(11, 13), 10)
  const out: Hour[] = []
  hourly.time.forEach((t: string, j: number) => {
    if (t.slice(0, 10) !== dateStr) return
    const hr = parseInt(t.slice(11, 13), 10)
    if (hr < srH || hr > ssH) return
    out.push({
      hr,
      kn:   toKnots(hourly.windspeed_10m[j]),
      gust: toKnots(hourly.windgusts_10m[j] ?? 0),
      dir:  hourly.winddirection_10m[j],
      code: hourly.weather_code[j] ?? 0,
    })
  })
  return out
}

export function getGoodSessions(wx: any, spotDirs: number[], spotDays: number[] | null): Session[] {
  const sessions: Session[] = []
  for (let i = 0; i < wx.daily.time.length; i++) {
    const dateStr = wx.daily.time[i]
    if (spotDays && spotDays.length) {
      const dow = new Date(dateStr + 'T12:00:00').getDay()
      if (!spotDays.includes(dow)) continue
    }

    const good = goodHours(dayHours(wx, i), spotDirs)
    if (good.length < 2) continue

    const sumKn  = good.reduce((s, h) => s + h.kn, 0)
    const avgKn  = Math.round(sumKn / good.length)
    const maxGust = good.reduce((m, h) => Math.max(m, h.gust), 0)

    const dirCounts: Record<number, number> = {}
    for (const h of good) {
      const bucket = Math.round(((h.dir % 360) + 360) % 360 / 45) * 45 % 360
      dirCounts[bucket] = (dirCounts[bucket] ?? 0) + 1
    }
    const domDir = parseInt(Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0][0])

    // Best window: longest run of consecutive clock hours among the good hours.
    let bestStart = good[0].hr, bestLen = 1
    let curStart  = good[0].hr, curLen = 1
    for (let k = 1; k < good.length; k++) {
      if (good[k].hr === good[k - 1].hr + 1) {
        curLen++
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart }
      } else {
        curStart = good[k].hr; curLen = 1
      }
    }
    const pad = (h: number) => `${String(h).padStart(2, '0')}h00`

    sessions.push({
      date: dateStr,
      date_label:  new Date(dateStr + 'T12:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' }),
      day_of_week: new Date(dateStr + 'T12:00:00').toLocaleDateString('en', { weekday: 'long' }),
      start_time: pad(good[0].hr),
      duration_hours: good.length,
      avg_kn: avgKn,
      max_gust: maxGust,
      dom_dir: compass(domDir),
      dir_arrow: dirArrow(domDir),
      win_start: pad(bestStart),
      win_end: pad(bestStart + bestLen),
      win_hours: bestLen,
    })
  }
  return sessions
}
