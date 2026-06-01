import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')!
const MAKE_WEBHOOK_URL     = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const toKnots   = (ms: number) => Math.round(ms * 1.94384)
const isRainy   = (code: number) => code >= 51
const speedTier = (kn: number) => kn >= 25 ? 3 : kn >= 20 ? 2 : kn >= 15 ? 1 : 0

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
function isWindDirOK(dir: number, spotDirs: number[]): boolean {
  if (!spotDirs.length) return true
  return spotDirs.some(sd => angleDiff(dir, sd) <= 22.5)
}

async function fetchForecast(lat: number, lon: number) {
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: 'weather_code,windspeed_10m,winddirection_10m',
    daily: 'sunrise,sunset',
    forecast_days: '10', timezone: 'auto', windspeed_unit: 'ms',
  })
  const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  const wx = await resp.json()
  if (wx.error) throw new Error(wx.reason)
  return wx
}

function getGoodSessions(wx: any, spotDirs: number[], spotDays: number[] | null) {
  const { daily, hourly } = wx
  const sessions = []
  for (let i = 0; i < daily.time.length; i++) {
    const dateStr = daily.time[i]
    if (spotDays && spotDays.length) {
      const dow = new Date(dateStr + 'T12:00:00').getDay()
      if (!spotDays.includes(dow)) continue
    }
    const srH = parseInt(daily.sunrise[i].slice(11, 13), 10)
    const ssH = parseInt(daily.sunset[i].slice(11, 13), 10)
    let qh = 0, peakKn = 0, firstHr: number | null = null
    hourly.time.forEach((t: string, j: number) => {
      if (t.slice(0, 10) !== dateStr) return
      const hr = parseInt(t.slice(11, 13), 10)
      if (hr < srH || hr > ssH) return
      const kn = toKnots(hourly.windspeed_10m[j])
      const dir = hourly.winddirection_10m[j]
      const code = hourly.weather_code[j] ?? 0
      if (speedTier(kn) > 0 && !isRainy(code) && isWindDirOK(dir, spotDirs)) {
        if (firstHr === null) firstHr = hr
        qh++
        if (kn > peakKn) peakKn = kn
      }
    })
    if (qh >= 2) {
      sessions.push({
        date: dateStr,
        date_label: new Date(dateStr + 'T12:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' }),
        day_of_week: new Date(dateStr + 'T12:00:00').toLocaleDateString('en', { weekday: 'long' }),
        start_time: firstHr !== null ? `${String(firstHr).padStart(2, '0')}h00` : '',
        duration_hours: qh,
        peak_kn: peakKn,
      })
    }
  }
  return sessions
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // Optional email_filter: when set, send only to that user (on-demand trigger)
  let emailFilter: string | null = null
  try { const body = await req.json(); emailFilter = body?.email_filter ?? null } catch { /* no body */ }

  // Fetch opted-in users (or just the requesting user for on-demand sends)
  let query = supabase.from('profiles').select('email')
  if (emailFilter) {
    query = query.eq('email', emailFilter)
  } else {
    query = query.eq('digest_enabled', true)
  }
  const { data: profiles, error: profErr } = await query

  if (profErr) return new Response(JSON.stringify({ error: profErr.message }), { status: 500 })

  const emails = (profiles ?? []).map((p: any) => p.email)
  if (!emails.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 })

  // Fetch favourites for all opted-in users
  const { data: favs } = await supabase
    .from('favourites')
    .select('email,spot_name,spot_lat,spot_lon,spot_dirs,spot_days')
    .in('email', emails)

  // Group favs by email
  const favsByEmail = new Map<string, any[]>()
  for (const f of favs ?? []) {
    if (!favsByEmail.has(f.email)) favsByEmail.set(f.email, [])
    favsByEmail.get(f.email)!.push(f)
  }

  // Cache forecasts by lat,lon to avoid duplicate API calls
  const wxCache = new Map<string, any>()

  let sent = 0

  for (const email of emails) {
    const userFavs = favsByEmail.get(email) ?? []
    if (!userFavs.length) continue

    const spotForecasts = []
    const debugSpots: any[] = []
    for (const fav of userFavs) {
      const key = `${fav.spot_lat},${fav.spot_lon}`
      if (!wxCache.has(key)) {
        try { wxCache.set(key, await fetchForecast(fav.spot_lat, fav.spot_lon)) }
        catch { wxCache.set(key, null) }
      }
      const wx = wxCache.get(key)
      if (!wx) { debugSpots.push({ spot: fav.spot_name, error: 'no wx' }); continue }
      const dirs = fav.spot_dirs ?? []
      const days = fav.spot_days ?? null
      const sessions = getGoodSessions(wx, dirs, days)
      debugSpots.push({ spot: fav.spot_name, dirs, days, sessions_found: sessions.length })
      if (sessions.length) {
        spotForecasts.push({ spot: fav.spot_name, sessions })
      }
    }

    const totalSessions = spotForecasts.reduce((s, sf) => s + sf.sessions.length, 0)
    const weekStart = new Date().toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })

    // Pre-render spots HTML (max 10 spots)
    const spotsHtml = spotForecasts.slice(0, 10).map(sf => {
      const sessionRows = sf.sessions.map(sess => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;background-color:#1a2235;border:1px solid #242d42;border-radius:10px;">
          <tr>
            <td style="padding:14px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;width:40%;">
                    <p style="margin:0;font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#ffffff;letter-spacing:1px;">${sess.day_of_week}</p>
                    <p style="margin:2px 0 0 0;font-size:12px;color:#4a5568;">${sess.date_label}</p>
                  </td>
                  <td style="vertical-align:middle;text-align:center;width:30%;">
                    <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#4a5568;">Starts</p>
                    <p style="margin:4px 0 0 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:20px;color:#5dd4f0;">${sess.start_time}</p>
                  </td>
                  <td style="vertical-align:middle;text-align:right;width:30%;">
                    <p style="margin:0;font-family:'Bebas Neue',Arial,sans-serif;font-size:28px;color:#5dd4f0;line-height:1;">${sess.peak_kn}<span style="font-size:14px;color:#4a5568;"> kn</span></p>
                    <p style="margin:2px 0 0 0;font-size:11px;color:#4a5568;">${sess.duration_hours}h of good wind</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>`).join('')

      return `
        <tr>
          <td style="background-color:#0f1520;border-left:1px solid #1e2535;border-right:1px solid #1e2535;border-top:1px solid #1e2535;padding:20px 32px 4px 32px;">
            <p style="margin:0 0 2px 0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4a5568;">Spot</p>
            <p style="margin:0;font-family:'Bebas Neue',Arial,sans-serif;font-size:26px;color:#5dd4f0;letter-spacing:1px;">&#128205; ${sf.spot}</p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#141b27;border-left:1px solid #1e2535;border-right:1px solid #1e2535;padding:0 32px 20px 32px;">
            ${sessionRows}
          </td>
        </tr>`
    }).join('')

    const noSessionsHtml = totalSessions === 0 ? `
      <tr>
        <td style="background-color:#141b27;border:1px solid #1e2535;border-top:none;padding:40px 32px;text-align:center;">
          <p style="margin:0 0 8px 0;font-size:32px;">&#128168;</p>
          <p style="margin:0 0 6px 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#4a5568;">No sessions this week</p>
          <p style="margin:0;font-size:13px;color:#4a5568;line-height:1.5;">We're keeping an eye on your spots.<br/>You'll hear from us when the wind picks up.</p>
        </td>
      </tr>` : ''

    const payload = {
      notification_type: 'digest',
      email,
      week_start: weekStart,
      total_good_sessions: totalSessions,
      has_sessions: totalSessions > 0,
      spots_html: spotsHtml,
      no_sessions_html: noSessionsHtml,
      debug_spots: debugSpots,
    }

    await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    sent++
  }

  return new Response(JSON.stringify({ sent, total_users: emails.length, debug: 'check make webhook logs for debug_spots' }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})
