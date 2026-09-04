import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { toKnots, hourQualifies, consecutiveRuns } from '../_shared/rideability.ts'
import { fetchSharedForecast } from '../_shared/forecast-client.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')
// One email per session, at 24 hours. The ladder used to be [72,48,24,6,1],
// which meant five emails for one spot on one day — one rider watching a single
// spot took 35 emails in a week, which is indistinguishable from spam. At 72h a
// wind forecast is not reliable enough to act on, and at 1h it is too late to
// arrange anything, so 24h is the one worth sending.
//
// The 1h row is still created, and process-reminders still runs it: it is what
// records session_peak_kn and the ground-truth wind the Stats page reads, and
// what fires the premium SMS. It just no longer sends an email.
const REMINDER_HOURS       = [24, 1]
export const EMAIL_REMINDER_HOURS = [24]

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── FORECAST HELPERS ──
// The rideability rule is shared with the app and the other edge functions.

function buildDay(dateStr, sunrise, sunset, hourlyMap, spotDirs) {
  const srHour = parseInt(sunrise.slice(11, 13), 10)
  const ssHour = parseInt(sunset.slice(11, 13), 10)
  const qual = []
  for (let hr = srHour; hr <= ssHour; hr++) {
    const d = hourlyMap.get(hr)
    if (!d) continue
    if (hourQualifies(d.kn, d.dir, d.code, d.gustKn, spotDirs)) {
      qual.push({ ...d, hour: hr })
    }
  }
  // Same 2+ consecutive-hour rule the app uses for "rideable".
  return { good: consecutiveRuns(qual, h => h.hour) }
}

// The same shared, Stormglass-backed row the app draws — a reminder is only
// scheduled for a session the rider can also see.
async function fetchForecast(lat, lon) {
  return await fetchSharedForecast(lat, lon, 10)
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

  // Fetch active reminders to know which (email, spot) pairs are subscribed and which dates already have rows
  const { data: active, error } = await supabase
    .from('reminders')
    .select('email,spot_name,spot_lat,spot_lon,spot_dirs,spot_city,spot_country,spot_map_link,app_link,session_date')
    .eq('cancelled', false)
    .gte('session_date', today)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  // Fetch spot_days preferences from favourites for every active (email, spot) pair
  const pairs = [...new Set((active ?? []).map(r => `${r.email}|${r.spot_name}`))]
  const spotDaysMap = new Map<string, number[] | null>()
  if (pairs.length) {
    const emails    = [...new Set((active ?? []).map(r => r.email))]
    const spotNames = [...new Set((active ?? []).map(r => r.spot_name))]
    const { data: favRows } = await supabase
      .from('favourites')
      .select('email,spot_name,spot_days')
      .in('email', emails)
      .in('spot_name', spotNames)
    for (const f of favRows ?? []) {
      spotDaysMap.set(`${f.email}|${f.spot_name}`, f.spot_days ?? null)
    }
  }

  const subMap = new Map()
  for (const r of active ?? []) {
    const key = `${r.email}|${r.spot_name}`
    if (!subMap.has(key)) {
      subMap.set(key, {
        email: r.email, spot_name: r.spot_name,
        spot_lat: r.spot_lat, spot_lon: r.spot_lon,
        spot_dirs: r.spot_dirs, spot_city: r.spot_city,
        spot_country: r.spot_country, spot_map_link: r.spot_map_link,
        app_link: r.app_link,
        spot_days: spotDaysMap.get(key) ?? null,
        existingDates: new Set(),
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
      const newSessions = qualSessions.filter(s => {
        if (sub.existingDates.has(s.dateStr)) return false
        if (sub.spot_days && sub.spot_days.length) {
          const dow = new Date(s.dateStr + 'T12:00:00').getDay()
          if (!sub.spot_days.includes(dow)) return false
        }
        return true
      })

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
