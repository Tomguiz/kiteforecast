// How the background jobs get a forecast.
//
// The reminder, new-session and digest jobs used to call Open-Meteo on their
// own, so a mail could promise a session the app had already stopped showing.
// They now read the same row every rider reads: the shared `forecast` function
// keeps one cached, Stormglass-backed forecast per spot, and one Stormglass
// request answers for the app and every job alike. That is also what keeps a
// job that loops over a hundred spots from spending the day's quota by itself.
//
// If the function cannot be reached the job fetches upstream directly, with
// the same provider chain — a mail sent on older-quality data still beats one
// not sent.
//
// Environment is read at call time, not import time, so this module can be
// imported by the unit tests without a Deno runtime behind it.

import { fetchForecastBundle, trimDays } from './forecast-source.ts'

const env = (k: string): string | undefined =>
  typeof Deno !== 'undefined' && Deno.env ? Deno.env.get(k) ?? undefined : undefined

export interface SharedForecastOptions {
  fetchFn?: typeof fetch
  functionUrl?: string | null
  serviceKey?: string | null
  stormglassKey?: string | null
  source?: string
}

export async function fetchSharedForecast(lat: number, lon: number, days: number, opts: SharedForecastOptions = {}) {
  const fetchFn = opts.fetchFn ?? fetch
  const base = opts.functionUrl === undefined ? env('SUPABASE_URL') : opts.functionUrl
  const serviceKey = opts.serviceKey === undefined ? env('SB_SERVICE_ROLE_KEY') : opts.serviceKey

  if (base && serviceKey) {
    try {
      const url = `${base.replace(/\/$/, '')}/functions/v1/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 15_000)
      let res: Response
      try {
        res = await fetchFn(url, { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey }, signal: ac.signal })
      } finally { clearTimeout(t) }
      const body = res.ok ? await res.json().catch(() => null) : null
      if (body?.wx && !body.wx.error) return trimDays(body.wx, days)
      console.warn(`shared forecast function answered ${res.status}; fetching upstream directly`)
    } catch (err) {
      console.warn('shared forecast function unreachable; fetching upstream directly:', String((err as Error)?.message || err))
    }
  }

  // The same switch the forecast function honours, so a job that has to go
  // upstream itself reads the same source the app does.
  const sgOn = (env('STORMGLASS_FORECAST') || '').toLowerCase() === 'on'
  const { wx } = await fetchForecastBundle(lat, lon, {
    fetchFn,
    stormglassKey: opts.stormglassKey === undefined ? (sgOn ? env('STORMGLASS_KEY') ?? null : null) : opts.stormglassKey,
    disabledReason: opts.stormglassKey === undefined && !sgOn ? 'STORMGLASS_FORECAST is off' : undefined,
    source: opts.source ?? env('STORMGLASS_SOURCE'),
    days: Math.max(days, 10),
  })
  return trimDays(wx, days)
}
