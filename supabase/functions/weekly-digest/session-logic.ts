// Pure session-detection logic for the weekly digest.
//
// Extracted from index.ts so it can be unit-tested without deploying: a
// silent divergence between this rule and the app's own rideability rule
// (index.html `hourQualifies`/`dayGoodHours`) is exactly what made the
// digest mail "No sessions this week" for days the app showed as rideable.
// Keep the two definitions in lockstep — see rule notes on hourQualifies().

export const toKnots   = (ms: number) => Math.round(ms * 1.94384)
export const isRainy   = (code: number) => code >= 51
export const speedTier = (kn: number) => kn >= 25 ? 3 : kn >= 20 ? 2 : kn >= 15 ? 1 : 0

const DIRS8   = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const ARROWS8 = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘']
export const compass  = (deg: number) => DIRS8[Math.round(((deg % 360) + 360) % 360 / 45) % 8]
export const dirArrow = (deg: number) => ARROWS8[Math.round(((deg % 360) + 360) % 360 / 45) % 8]

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export function isWindDirOK(dir: number, spotDirs: number[]): boolean {
  if (!spotDirs.length) return true
  return spotDirs.some(sd => angleDiff(dir, sd) <= 22.5)
}

// Mirrors index.html `hourQualifies`. The gusty clause matters: a 13 kn day
// gusting 22 is rideable in the app, and dropping it here hid real sessions.
export function hourQualifies(
  kn: number, dir: number, code: number, gustKn: number, spotDirs: number[],
): boolean {
  return (speedTier(kn) > 0 || (kn >= 12 && (gustKn || 0) >= 20))
    && !isRainy(code)
    && isWindDirOK(dir, spotDirs)
}

export async function fetchForecast(lat: number, lon: number) {
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: 'weather_code,windspeed_10m,windgusts_10m,winddirection_10m',
    daily: 'sunrise,sunset',
    forecast_days: '10', timezone: 'auto', windspeed_unit: 'ms',
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
  const qual = hours.filter(h => hourQualifies(h.kn, h.dir, h.code, h.gust, spotDirs))
  const qualSet = new Set(qual.map(h => h.hr))
  return qual.filter(h => qualSet.has(h.hr - 1) || qualSet.has(h.hr + 1))
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
