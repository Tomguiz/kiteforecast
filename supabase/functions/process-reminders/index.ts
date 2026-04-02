import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAKE_WEBHOOK_URL        = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── WMO WEATHER CODES ──
const WMO: Record<number, [string, string]> = {
  0:['☀️','Clear'],1:['🌤','Mainly clear'],2:['⛅','Partly cloudy'],3:['☁️','Overcast'],
  45:['🌫','Fog'],48:['🌫','Icy fog'],
  51:['🌦','Light drizzle'],53:['🌦','Drizzle'],55:['🌧','Heavy drizzle'],
  56:['🌨','Frz drizzle'],57:['🌨','Heavy frz drizzle'],
  61:['🌧','Slight rain'],63:['🌧','Rain'],65:['🌧','Heavy rain'],
  66:['🌨','Frz rain'],67:['🌨','Heavy frz rain'],
  71:['🌨','Slight snow'],73:['🌨','Snow'],75:['❄️','Heavy snow'],77:['🌨','Snow grains'],
  80:['🌦','Showers'],81:['🌧','Showers'],82:['⛈','Violent showers'],
  85:['🌨','Snow showers'],86:['🌨','Heavy snow showers'],
  95:['⛈','Thunderstorm'],96:['⛈','Thunderstorm+hail'],99:['⛈','Thunderstorm+hail'],
}
const wmoInfo = (c: number): [string, string] => WMO[c] ?? ['🌡', '—']

// ── FORECAST HELPERS (mirrors app logic exactly) ──
const toKnots  = (ms: number) => Math.round(ms * 1.94384)
const isRainy  = (code: number) => code >= 51
const speedTier = (kn: number) => kn >= 25 ? 3 : kn >= 20 ? 2 : kn >= 15 ? 1 : 0

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
function isWindDirOK(dir: number, spotDirs: number[]): boolean {
  if (!spotDirs.length) return true
  return spotDirs.some(sd => angleDiff(dir, sd) <= 22.5)
}
function classifyHour(kn: number, dir: number, code: number, spotDirs: number[]) {
  const sp = speedTier(kn)
  if (sp === 0)           return { type: 'light',   qualifying: false }
  if (isRainy(code))      return { type: 'rain',    qualifying: false }
  if (!isWindDirOK(dir, spotDirs)) return { type: 'lightdir', qualifying: false }
  return { type: ['good','verygood','perfect'][sp - 1], qualifying: true }
}
function circMean(angles: number[]): number {
  const s = angles.reduce((a, d) => a + Math.sin(d * Math.PI / 180), 0)
  const c = angles.reduce((a, d) => a + Math.cos(d * Math.PI / 180), 0)
  return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360
}
function compass(deg: number): string {
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8]
}

interface HourData { kn: number; dir: number; code: number; temp: number; gustKn: number }

function buildDay(dateStr: string, sunrise: string, sunset: string, hourlyMap: Map<number, HourData>, spotDirs: number[]) {
  const srHour = parseInt(sunrise.slice(11, 13), 10)
  const ssHour = parseInt(sunset.slice(11, 13), 10)
  const day: Array<HourData & { type: string; qualifying: boolean; hour: number }> = []
  for (let hr = srHour; hr <= ssHour; hr++) {
    const d = hourlyMap.get(hr)
    if (!d) continue
    const cl = classifyHour(d.kn, d.dir, d.code, spotDirs)
    day.push({ ...d, ...cl, hour: hr })
  }
  const good    = day.filter(h => h.qualifying)
  const peakKn  = good.length ? Math.max(...good.map(h => h.kn)) : 0
  const peakDayKn = day.length ? Math.max(...day.map(h => h.kn)) : 0
  const sample  = good.length ? good : day
  const domDir  = sample.length ? circMean(sample.map(h => h.dir)) : null
  const hasBadDir = day.some(h => h.type === 'lightdir')
  return { day, good, goodHours: good.length, peakKn, peakDayKn, domDir, hasBadDir }
}

function rateDay(gh: number, pk: number, code: number, badDir: boolean, peakDay: number): string {
  if ([82,95,96,99].includes(code))       return '⚡ Storm'
  if (gh === 0) {
    if (isRainy(code) && peakDay >= 10)   return '🌧 Rain / snow'
    if (badDir && peakDay >= 15)          return '❌ Wrong direction'
    if (peakDay >= 10)                    return '💨 Too light'
    return '😴 No wind'
  }
  if (gh === 1)  return '❌ Too brief (1h)'
  if (gh === 2)  return `⏱ 2h window · ${pk}kn`
  if (gh <= 4) {
    if (pk >= 25) return `✅ ${gh}h · 25+ kn`
    if (pk >= 20) return `✅ ${gh}h · 20+ kn`
    return `🤔 ${gh}h · 15+ kn`
  }
  if (pk >= 25) return `🪁 ${gh}h · Perfect!`
  if (pk >= 20) return `✅ ${gh}h · Very Good`
  return `✅ ${gh}h · Good`
}

function fmtDateLabel(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  })
}

// ── MAIN HANDLER ──
Deno.serve(async () => {
  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('*')
    .lte('send_at', new Date().toISOString())
    .eq('sent', false)
    .eq('cancelled', false)

  if (error) {
    console.error('Failed to fetch reminders:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  let processed = 0

  for (const r of reminders ?? []) {
    try {
      // Re-fetch live forecast
      const params = new URLSearchParams({
        latitude:      String(r.spot_lat),
        longitude:     String(r.spot_lon),
        hourly:        'weather_code,windspeed_10m,winddirection_10m,windgusts_10m,temperature_2m',
        daily:         'weather_code,temperature_2m_max,temperature_2m_min,windgusts_10m_max,sunrise,sunset',
        forecast_days: '10',
        timezone:      'auto',
        windspeed_unit:'ms',
      })
      const wxRes = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
      const wx    = await wxRes.json()
      if (wx.error) throw new Error(wx.reason)

      const dayIdx = (wx.daily.time as string[]).indexOf(r.session_date)
      if (dayIdx === -1) {
        // Date no longer in 10-day window — mark sent, skip email
        await supabase.from('reminders').update({ sent: true }).eq('id', r.id)
        continue
      }

      // Build hourly map for the target date
      const hourlyMap = new Map<number, HourData>()
      ;(wx.hourly.time as string[]).forEach((t: string, i: number) => {
        if (t.slice(0, 10) !== r.session_date) return
        const hr = parseInt(t.slice(11, 13), 10)
        hourlyMap.set(hr, {
          kn:     toKnots(wx.hourly.windspeed_10m[i]),
          dir:    wx.hourly.winddirection_10m[i],
          code:   wx.hourly.weather_code[i] ?? 0,
          temp:   Math.round(wx.hourly.temperature_2m[i]),
          gustKn: toKnots(wx.hourly.windgusts_10m[i]),
        })
      })

      const sunrise   = wx.daily.sunrise[dayIdx] as string
      const sunset    = wx.daily.sunset[dayIdx]  as string
      const spotDirs  = (r.spot_dirs ?? []) as number[]
      const code      = wx.daily.weather_code[dayIdx] as number
      const [, weatherDesc] = wmoInfo(code)

      const { day, good, goodHours, peakKn, domDir, hasBadDir, peakDayKn } =
        buildDay(r.session_date, sunrise, sunset, hourlyMap, spotDirs)

      const rating          = rateDay(goodHours, peakKn, code, hasBadDir, peakDayKn)
      const sessionStart    = good.length ? `${r.session_date}T${String(good[0].hour).padStart(2,'0')}:00` : `${r.session_date}T10:00`
      const sessionEnd      = good.length ? `${r.session_date}T${String(good[good.length-1].hour).padStart(2,'0')}:00` : ''
      const gusts           = good.length ? Math.max(...good.map(h => h.gustKn)) : 0
      const windMin         = good.length ? Math.min(...good.map(h => h.kn))     : 0
      const consistencyPct  = day.length  ? Math.round(good.length / day.length * 100) : 0
      const rh              = r.reminder_hours as number

      const payload = {
        notification_type:  r.notif_type,
        reminder_label:     rh === 1 ? '1 hour before' : `${rh} hours before`,
        email:              r.email,
        spot:               r.spot_name,
        spot_city:          r.spot_city,
        spot_country:       r.spot_country,
        spot_map_link:      r.spot_map_link,
        date:               r.session_date,
        date_label:         fmtDateLabel(r.session_date),
        app_link:           r.app_link,
        session: {
          start_time:           sessionStart,
          end_time:             sessionEnd,
          duration_hours:       goodHours,
          wind_speed_peak_kn:   peakKn,
          wind_speed_min_kn:    windMin,
          wind_gusts_kn:        gusts,
          wind_direction:       domDir !== null ? compass(domDir) : '—',
          wind_consistency_pct: consistencyPct,
          rating,
        },
        conditions: {
          weather:           weatherDesc,
          temperature_max_c: Math.round(wx.daily.temperature_2m_max[dayIdx]),
          temperature_min_c: Math.round(wx.daily.temperature_2m_min[dayIdx]),
          sunrise:           sunrise.slice(11, 16),
          sunset:            sunset.slice(11, 16),
          daylight_hours:    day.length,
        },
        user_good_wind_dirs: spotDirs.map(compass),
      }

      await fetch(MAKE_WEBHOOK_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })

      await supabase.from('reminders').update({ sent: true }).eq('id', r.id)
      processed++
    } catch (e) {
      console.error('Failed to process reminder', r.id, e)
    }
  }

  return new Response(JSON.stringify({ processed, total: reminders?.length ?? 0 }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
