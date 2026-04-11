import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')
const REMINDER_HOURS       = [72, 48, 24, 6, 1]

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── FORECAST HELPERS (mirrors process-reminders exactly) ──
const toKnots   = (ms) => Math.round(ms * 1.94384)
const isRainy   = (code) => code >= 51
const speedTier = (kn) => kn >= 25 ? 3 : kn >= 20 ? 2 : kn >= 15 ? 1 : 0

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
function isWindDirOK(dir, spotDirs) {
  if (!spotDirs || !spotDirs.length) return true
  return spotDirs.some(sd => angleDiff(dir, sd) <= 22.5)
}
function classifyHour(kn, dir, code, spotDirs) {
  const sp = speedTier(kn)
  if (sp === 0)                    return { qualifying: false }
  if (isRainy(code))               return { qualifying: false }
  if (!isWindDirOK(dir, spotDirs)) return { qualifying: false }
  return { qualifying: true }
}

function buildDay(dateStr, sunrise, sunset, hourlyMap, spotDirs) {
  const srHour = parseInt(sunrise.slice(11, 13), 10)
  const ssHour = parseInt(sunset.slice(11, 13), 10)
  const good = []
  for (let hr = srHour; hr <= ssHour; hr++) {
    const d = hourlyMap.get(hr)
    if (!d) continue
    if (classifyHour(d.kn, d.dir, d.code, spotDirs).qualifying) {
      good.push({ ...d, hour: hr })
    }
  }
  return { good }
}

async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude:       String(lat),
    longitude:      String(lon),
    hourly:         'weather_code,windspeed_10m,winddirection_10m,windgusts_10m,temperature_2m',
    daily:          'weather_code,temperature_2m_max,temperature_2m_min,windgusts_10m_max,sunrise,sunset',
    forecast_days:  '10',
    timezone:       'auto',
    windspeed_unit: 'ms',
  })
  const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  const wx = await resp.json()
  if (wx.error) throw new Error(wx.reason)
  return wx
}

function computeQualSessions(wx, spotDirs) {
  const { daily, hourly } = wx
  const sessions = []
  for (let i = 0; i < daily.time.length; i++) {
    const dateStr = daily.time[i]
    const hourlyMap = new Map()
    hourly.time.forEach((t, idx) => {
      if (t.slice(0, 10) !== dateStr) return
      hourlyMap.set(parseInt(t.slice(11, 13), 10), {
        kn:     toKnots(hourly.windspeed_10m[idx]),
        dir:    hourly.winddirection_10m[idx],
        code:   hourly.weather_code[idx] ?? 0,
        gustKn: toKnots(hourly.windgusts_10m[idx]),
      })
    })
    const { good } = buildDay(dateStr, daily.sunrise[i], daily.sunset[i], hourlyMap, spotDirs)
    if (good.length >= 2) {
      sessions.push({
        dateStr,
        sessionStart: `${dateStr}T${String(good[0].hour).padStart(2, '0')}:00`,
      })
    }
  }
  return sessions
}

Deno.serve(async () => {
  const today = new Date().toISOString().slice(0, 10)

  const { data: active, error } = await supabase
    .from('reminders')
    .select('email,spot_name,spot_lat,spot_lon,spot_dirs,spot_city,spot_country,spot_map_link,app_link,session_date')
    .eq('cancelled', false)
    .gte('session_date', today)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const subMap = new Map()
  for (const r of active ?? []) {
    const key = `${r.email}|${r.spot_name}`
    if (!subMap.has(key)) {
      subMap.set(key, {
        email: r.email, spot_name: r.spot_name,
        spot_lat: r.spot_lat, spot_lon: r.spot_lon,
        spot_dirs: r.spot_dirs, spot_city: r.spot_city,
        spot_country: r.spot_country, spot_map_link: r.spot_map_link,
        app_link: r.app_link, existingDates: new Set(),
      })
    }
    subMap.get(key).existingDates.add(r.session_date)
  }

  let scheduled = 0
  const now = Date.now()

  for (const sub of subMap.values()) {
    try {
      const wx = await fetchForecast(sub.spot_lat, sub.spot_lon)
      const qualSessions = computeQualSessions(wx, sub.spot_dirs ?? [])
      const newSessions = qualSessions.filter(s => !sub.existingDates.has(s.dateStr))

      for (const sess of newSessions) {
        const sessionMs = new Date(sess.sessionStart).getTime()
        const appLink = sub.app_link
          ? sub.app_link.replace(/date=[^&]+/, `date=${sess.dateStr}`)
          : null

        const rows = REMINDER_HOURS
          .map(h => ({
            email:          sub.email,
            spot_name:      sub.spot_name,
            spot_lat:       sub.spot_lat,
            spot_lon:       sub.spot_lon,
            spot_city:      sub.spot_city,
            spot_country:   sub.spot_country,
            spot_dirs:      sub.spot_dirs,
            spot_map_link:  sub.spot_map_link,
            session_date:   sess.dateStr,
            notif_type:     'spot',
            reminder_hours: h,
            send_at:        new Date(sessionMs - h * 3600 * 1000).toISOString(),
            sent:           false,
            cancelled:      false,
            app_link:       appLink,
          }))
          .filter(r => new Date(r.send_at).getTime() > now)

        if (rows.length) {
          await supabase
            .from('reminders')
            .upsert(rows, { onConflict: 'email,spot_name,notif_type,session_date,reminder_hours' })
          scheduled += rows.length
        }
      }
    } catch (err) {
      console.error(`Error checking ${sub.spot_name} for ${sub.email}:`, err)
    }
  }

  return new Response(
    JSON.stringify({ subscriptions: subMap.size, scheduled }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
