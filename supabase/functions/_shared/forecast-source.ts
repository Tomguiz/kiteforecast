// Where a forecast comes from.
//
// Two upstreams, one shape. Everything downstream — the app, the rating, the
// planner, the reminder and digest mails — reads an Open-Meteo-shaped payload:
// `hourly.time` in the spot's local clock, wind in m/s, a WMO weather code,
// `daily.sunrise/sunset`. That shape stays. What changes is where the numbers
// inside it come from.
//
//   Stormglass  — the paid, marine-first source. Its `sg` source picks the
//                 best model for the point (ECMWF, ICON, Météo-France, NOAA,
//                 UKMO, ...), hourly, 10 days ahead. It is what the tide badge
//                 already reads. The wind, gusts, direction, temperature,
//                 waves and the weather picture for the next ten days are its.
//   Open-Meteo  — free. Still asked, for the three things Stormglass does not
//                 hand back: the spot's timezone, sunrise/sunset, and the days
//                 11–16 outlook (already faded as low-confidence in the app).
//                 It is also the whole answer when Stormglass is unreachable
//                 or the daily quota is spent — an older-quality forecast beats
//                 no forecast.
//
// `wx.provider` says which of the two the wind came from, so the app can show
// it and the accuracy tool can score it. Pure where it can be: the merge and
// the WMO derivation take data and return data, so they are unit-tested.

export const CELL_SELECTION = 'sea'   // see forecast/index.ts for the measurement behind this
export const FORECAST_DAYS = 16
// Stormglass forecasts ten days ahead; a request without start/end returns
// exactly that window, so the window is never asked for and never wrong.
export const STORMGLASS_DAYS = 10
export const STORMGLASS_DEFAULT_SOURCE = 'sg'
export const STORMGLASS_PARAMS = [
  'windSpeed', 'gust', 'windDirection', 'airTemperature', 'cloudCover', 'precipitation',
  'waveHeight', 'wavePeriod', 'waveDirection',
]
// Keep a few requests of the day's quota in hand for the tide badge, which
// draws on the same key. Once the reserve is reached the day is Open-Meteo's.
export const STORMGLASS_QUOTA_RESERVE = 5

export function openMeteoForecastUrl(lat: number, lon: number, days = FORECAST_DAYS) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: 'temperature_2m,weather_code,windspeed_10m,winddirection_10m,windgusts_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,windgusts_10m_max,sunrise,sunset',
    forecast_days: String(days), timezone: 'auto', windspeed_unit: 'ms',
    cell_selection: CELL_SELECTION,
  })
  return `https://api.open-meteo.com/v1/forecast?${p}`
}
export function openMeteoMarineUrl(lat: number, lon: number, days = FORECAST_DAYS) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: 'wave_height,wave_period,wave_direction',
    forecast_days: String(days), timezone: 'auto',
    cell_selection: CELL_SELECTION,
  })
  return `https://marine-api.open-meteo.com/v1/marine?${p}`
}
// The key travels in the Authorization header, never in the URL: URLs end up
// in logs and error messages, headers do not.
export function stormglassUrl(lat: number, lon: number, source = STORMGLASS_DEFAULT_SOURCE) {
  const p = new URLSearchParams({
    lat: String(lat), lng: String(lon), params: STORMGLASS_PARAMS.join(','), source,
  })
  return `https://api.stormglass.io/v2/weather/point?${p}`
}

// ── The weather picture ─────────────────────────────────────────────────────
// Stormglass has no WMO code; it has cloud cover (%) and precipitation (mm/h).
// The app only ever asks two things of the code: which icon to draw, and
// whether it is raining (rideability's `isRainy` is `code >= 51`). Standard
// intensity classes: light under 2.5 mm/h, moderate to 7.6, heavy above.
export function toWmoCode(cloudPct: number | null, precipMmH: number | null, tempC: number | null): number {
  const p = precipMmH ?? 0
  const snow = tempC != null && tempC <= 0
  if (p > 7.6) return snow ? 75 : 65
  if (p >= 2.5) return snow ? 73 : 63
  if (p >= 0.5) return snow ? 71 : 61
  if (p > 0.1)  return snow ? 71 : 51
  const c = cloudPct ?? 0
  if (c <= 12) return 0
  if (c <= 37) return 1
  if (c <= 75) return 2
  return 3
}

// Open-Meteo stamps hours in the spot's local clock, without an offset, and
// hands back the offset it used. Stormglass stamps in UTC. Same instant, same
// key — or nothing lines up.
export function localHourKey(utcIso: string, utcOffsetSeconds: number): string | null {
  const ms = Date.parse(utcIso)
  if (!Number.isFinite(ms)) return null
  return new Date(ms + utcOffsetSeconds * 1000).toISOString().slice(0, 13) + ':00'
}

export type Provider = {
  name: 'stormglass' | 'open-meteo'
  source?: string          // Stormglass source the numbers came from
  hours?: number           // hourly slots the premium source filled
  through?: string         // last local hour it covered (YYYY-MM-DDTHH:00)
  reason?: string          // why it is not Stormglass, when it is not
}

type SgHour = Record<string, any> & { time: string }
const pickNum = (v: unknown): number | null => {
  const n = typeof v === 'object' && v !== null ? Object.values(v as Record<string, unknown>)[0] : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// Lay Stormglass's hours over the Open-Meteo scaffold. Mutates copies; returns
// the merged pair and how many hours were replaced. An hour Stormglass does not
// have keeps Open-Meteo's numbers, so a gap never turns into a hole.
export function overlayStormglass(wx: any, marine: any, sgHours: SgHour[], source: string) {
  const out = structuredClone(wx)
  const h = out?.hourly
  if (!h || !Array.isArray(h.time)) return { wx, marine, covered: 0, through: null as string | null }
  const offset = Number(out.utc_offset_seconds) || 0
  const index = new Map<string, number>()
  h.time.forEach((t: string, i: number) => index.set(t, i))

  let m = marine ? structuredClone(marine) : null
  const ensureMarine = () => {
    if (m?.hourly?.time) return m
    m = {
      latitude: out.latitude, longitude: out.longitude, timezone: out.timezone,
      utc_offset_seconds: out.utc_offset_seconds, hourly_units: { wave_height: 'm', wave_period: 's', wave_direction: '°' },
      hourly: {
        time: [...h.time],
        wave_height: h.time.map(() => null), wave_period: h.time.map(() => null), wave_direction: h.time.map(() => null),
      },
    }
    return m
  }
  const mIndex = new Map<string, number>()
  if (m?.hourly?.time) m.hourly.time.forEach((t: string, i: number) => mIndex.set(t, i))

  const touchedDays = new Set<string>()
  let covered = 0, through: string | null = null
  for (const sg of sgHours || []) {
    const key = localHourKey(sg?.time, offset)
    if (!key) continue
    const i = index.get(key)
    if (i === undefined) continue
    const ws = pickNum(sg.windSpeed)
    if (ws === null) continue              // no wind, no overlay: the hour is not usable
    h.windspeed_10m[i] = ws
    const g = pickNum(sg.gust);           if (g !== null) h.windgusts_10m[i] = g
    const d = pickNum(sg.windDirection);  if (d !== null) h.winddirection_10m[i] = d
    const t = pickNum(sg.airTemperature); if (t !== null) h.temperature_2m[i] = t
    h.weather_code[i] = toWmoCode(pickNum(sg.cloudCover), pickNum(sg.precipitation), h.temperature_2m[i])
    touchedDays.add(key.slice(0, 10))
    covered++
    if (!through || key > through) through = key

    const wh = pickNum(sg.waveHeight)
    if (wh !== null) {
      const mm = ensureMarine()
      let j = mIndex.get(key)
      if (j === undefined && mm.hourly.time.length === h.time.length) j = i
      if (j !== undefined) {
        mm.hourly.wave_height[j] = wh
        const wp = pickNum(sg.wavePeriod);    if (wp !== null) mm.hourly.wave_period[j] = wp
        const wd = pickNum(sg.waveDirection); if (wd !== null) mm.hourly.wave_direction[j] = wd
      }
    }
  }

  // The daily summaries the app reads are derived from the hours; redo them
  // for every day whose hours changed, from the merged series.
  const daily = out.daily
  if (covered && daily?.time) {
    daily.time.forEach((day: string, di: number) => {
      if (!touchedDays.has(day)) return
      let code = 0, tmax = -Infinity, tmin = Infinity, gmax = -Infinity
      h.time.forEach((t: string, i: number) => {
        if (t.slice(0, 10) !== day) return
        code = Math.max(code, h.weather_code[i] ?? 0)
        const temp = h.temperature_2m[i]; if (typeof temp === 'number') { tmax = Math.max(tmax, temp); tmin = Math.min(tmin, temp) }
        const g = h.windgusts_10m[i];     if (typeof g === 'number') gmax = Math.max(gmax, g)
      })
      if (Array.isArray(daily.weather_code))       daily.weather_code[di] = code
      if (Array.isArray(daily.temperature_2m_max) && tmax > -Infinity) daily.temperature_2m_max[di] = tmax
      if (Array.isArray(daily.temperature_2m_min) && tmin < Infinity)  daily.temperature_2m_min[di] = tmin
      if (Array.isArray(daily.windgusts_10m_max)  && gmax > -Infinity) daily.windgusts_10m_max[di] = gmax
    })
  }

  out.provider = covered
    ? { name: 'stormglass', source, hours: covered, through: through ?? undefined } satisfies Provider
    : { name: 'open-meteo', reason: 'no overlapping hours' } satisfies Provider
  return { wx: out, marine: m, covered, through }
}

// ── Quota ───────────────────────────────────────────────────────────────────
// Every Stormglass answer says how much of today's quota is used. Remember it,
// so the last requests of the day are not spent learning the day is over: a
// 402 costs a round trip and answers nothing.
export class QuotaGuard {
  private day = ''
  private used = 0
  private quota = Infinity
  private exhausted = false
  constructor(private reserve = STORMGLASS_QUOTA_RESERVE) {}
  private roll(now: Date) {
    const d = now.toISOString().slice(0, 10)
    if (d !== this.day) { this.day = d; this.used = 0; this.quota = Infinity; this.exhausted = false }
  }
  canSpend(now = new Date()): boolean {
    this.roll(now)
    return !this.exhausted && this.quota - this.used > this.reserve
  }
  note(meta: any, now = new Date()) {
    this.roll(now)
    if (typeof meta?.requestCount === 'number') this.used = meta.requestCount
    if (typeof meta?.dailyQuota === 'number') this.quota = meta.dailyQuota
  }
  markExhausted(now = new Date()) { this.roll(now); this.exhausted = true }
  get remaining() { return this.quota === Infinity ? Infinity : Math.max(0, this.quota - this.used) }
}

// ── Fetching ────────────────────────────────────────────────────────────────
export interface FetchOptions {
  stormglassKey?: string | null
  source?: string
  days?: number
  quota?: QuotaGuard
  fetchFn?: typeof fetch
  timeoutMs?: number
  now?: Date
}
export interface Bundle { wx: any; marine: any; provider: Provider }

async function timedFetch(fetchFn: typeof fetch, url: string, init: RequestInit, timeoutMs: number) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try { return await fetchFn(url, { ...init, signal: ac.signal }) }
  finally { clearTimeout(t) }
}

async function fetchOpenMeteo(lat: number, lon: number, days: number, fetchFn: typeof fetch, timeoutMs: number) {
  const [wxRes, mRes] = await Promise.all([
    timedFetch(fetchFn, openMeteoForecastUrl(lat, lon, days), {}, timeoutMs),
    timedFetch(fetchFn, openMeteoMarineUrl(lat, lon, days), {}, timeoutMs).catch(() => null),
  ])
  const wx = await wxRes.json()
  if (!wxRes.ok || wx?.error) throw new Error(wx?.reason || `Open-Meteo HTTP ${wxRes.status}`)
  // Marine has no data inland, and that is not a failure worth reporting.
  let marine: any = null
  if (mRes && mRes.ok) {
    const m = await mRes.json().catch(() => null)
    if (m && !m.error) marine = m
  }
  return { wx, marine }
}

type SgResult = { hours: SgHour[]; meta: any } | { reason: string }
async function fetchStormglass(lat: number, lon: number, key: string, source: string,
                               fetchFn: typeof fetch, timeoutMs: number, quota?: QuotaGuard, now = new Date()): Promise<SgResult> {
  if (quota && !quota.canSpend(now)) return { reason: 'quota reserve reached' }
  let res: Response
  try {
    res = await timedFetch(fetchFn, stormglassUrl(lat, lon, source), { headers: { Authorization: key } }, timeoutMs)
  } catch (err) {
    return { reason: `unreachable: ${(err as Error)?.name === 'AbortError' ? 'timeout' : String((err as Error)?.message || err)}` }
  }
  if (res.status === 402 || res.status === 429) {
    quota?.markExhausted(now)
    return { reason: `HTTP ${res.status} (quota)` }
  }
  if (!res.ok) return { reason: `HTTP ${res.status}` }
  const body = await res.json().catch(() => null)
  if (!body || !Array.isArray(body.hours)) return { reason: 'malformed response' }
  quota?.note(body.meta, now)
  return { hours: body.hours, meta: body.meta }
}

// The one call every consumer makes. Open-Meteo and Stormglass are asked at
// the same time; the answer is Stormglass's numbers on Open-Meteo's calendar
// when both come back, Open-Meteo's alone when Stormglass does not.
export async function fetchForecastBundle(lat: number, lon: number, opts: FetchOptions = {}): Promise<Bundle> {
  const fetchFn = opts.fetchFn ?? fetch
  const days = opts.days ?? FORECAST_DAYS
  const timeoutMs = opts.timeoutMs ?? 10_000
  const source = opts.source || STORMGLASS_DEFAULT_SOURCE
  const key = opts.stormglassKey || null

  const [om, sg] = await Promise.all([
    fetchOpenMeteo(lat, lon, days, fetchFn, timeoutMs),
    key ? fetchStormglass(lat, lon, key, source, fetchFn, timeoutMs, opts.quota, opts.now)
        : Promise.resolve<SgResult>({ reason: 'no STORMGLASS_KEY' }),
  ])

  if ('reason' in sg) {
    const provider: Provider = { name: 'open-meteo', reason: sg.reason }
    return { wx: { ...om.wx, provider }, marine: om.marine, provider }
  }
  const merged = overlayStormglass(om.wx, om.marine, sg.hours, source)
  return { wx: merged.wx, marine: merged.marine, provider: merged.wx.provider }
}

// Trim a bundle to its first `days` days — the reminder and digest jobs decide
// on a shorter window than the app draws, and a longer row must not quietly
// widen what they promise.
export function trimDays(wx: any, days: number) {
  if (!wx?.daily?.time || !wx?.hourly?.time) return wx
  const keep = new Set<string>(wx.daily.time.slice(0, days))
  const out = { ...wx, daily: { ...wx.daily }, hourly: { ...wx.hourly } }
  for (const k of Object.keys(out.daily)) if (Array.isArray(out.daily[k])) out.daily[k] = out.daily[k].slice(0, days)
  const idx: number[] = []
  wx.hourly.time.forEach((t: string, i: number) => { if (keep.has(t.slice(0, 10))) idx.push(i) })
  for (const k of Object.keys(out.hourly)) if (Array.isArray(out.hourly[k])) out.hourly[k] = idx.map(i => wx.hourly[k][i])
  return out
}
