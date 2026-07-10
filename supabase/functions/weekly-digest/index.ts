import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')!
const MAKE_WEBHOOK_URL     = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const toKnots   = (ms: number) => Math.round(ms * 1.94384)
const isRainy   = (code: number) => code >= 51
const speedTier = (kn: number) => kn >= 25 ? 3 : kn >= 20 ? 2 : kn >= 15 ? 1 : 0

const DIRS8   = ['N','NE','E','SE','S','SW','W','NW']
const ARROWS8 = ['↓','↙','←','↖','↑','↗','→','↘']
const compass  = (deg: number) => DIRS8[Math.round(((deg % 360) + 360) % 360 / 45) % 8]
const dirArrow = (deg: number) => ARROWS8[Math.round(((deg % 360) + 360) % 360 / 45) % 8]

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
    hourly: 'weather_code,windspeed_10m,windgusts_10m,winddirection_10m',
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

    let qh = 0, firstHr: number | null = null
    let sumKn = 0, maxGust = 0
    const dirCounts: Record<number, number> = {}
    // track qualifying hours in order for best-window computation
    const qualHours: number[] = []

    hourly.time.forEach((t: string, j: number) => {
      if (t.slice(0, 10) !== dateStr) return
      const hr = parseInt(t.slice(11, 13), 10)
      if (hr < srH || hr > ssH) return
      const kn   = toKnots(hourly.windspeed_10m[j])
      const gust = toKnots(hourly.windgusts_10m[j] ?? 0)
      const dir  = hourly.winddirection_10m[j]
      const code = hourly.weather_code[j] ?? 0
      if (speedTier(kn) > 0 && !isRainy(code) && isWindDirOK(dir, spotDirs)) {
        if (firstHr === null) firstHr = hr
        qh++
        sumKn += kn
        if (gust > maxGust) maxGust = gust
        const bucket = Math.round(((dir % 360) + 360) % 360 / 45) * 45 % 360
        dirCounts[bucket] = (dirCounts[bucket] ?? 0) + 1
        qualHours.push(hr)
      }
    })

    if (qh >= 2) {
      const avgKn = Math.round(sumKn / qh)
      const domDir = parseInt(Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0][0])

      // Best consecutive window: longest run of hours where each step is +1h
      let bestStart = qualHours[0], bestLen = 1
      let curStart = qualHours[0], curLen = 1
      for (let k = 1; k < qualHours.length; k++) {
        if (qualHours[k] === qualHours[k - 1] + 1) {
          curLen++
          if (curLen > bestLen) { bestLen = curLen; bestStart = curStart }
        } else {
          curStart = qualHours[k]; curLen = 1
        }
      }
      const bestEnd = bestStart + bestLen
      const winStart = `${String(bestStart).padStart(2, '0')}h00`
      const winEnd   = `${String(bestEnd).padStart(2, '0')}h00`

      sessions.push({
        date: dateStr,
        date_label: new Date(dateStr + 'T12:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' }),
        day_of_week: new Date(dateStr + 'T12:00:00').toLocaleDateString('en', { weekday: 'long' }),
        start_time: firstHr !== null ? `${String(firstHr).padStart(2, '0')}h00` : '',
        duration_hours: qh,
        avg_kn: avgKn,
        max_gust: maxGust,
        dom_dir: compass(domDir),
        dir_arrow: dirArrow(domDir),
        win_start: winStart,
        win_end: winEnd,
        win_hours: bestLen,
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

  let emailFilter: string | null = null
  try { const body = await req.json(); emailFilter = body?.email_filter ?? null } catch { /* no body */ }

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

  const { data: favs } = await supabase
    .from('favourites')
    .select('email,spot_name,spot_lat,spot_lon,spot_dirs,spot_days')
    .in('email', emails)

  const favsByEmail = new Map<string, any[]>()
  for (const f of favs ?? []) {
    if (!favsByEmail.has(f.email)) favsByEmail.set(f.email, [])
    favsByEmail.get(f.email)!.push(f)
  }

  // Canonical wind directions live in spot_overrides (admin-maintained). The
  // dirs copied into each favourites row are a point-in-time snapshot and go
  // stale when an admin later corrects a spot's directions — which is what hid
  // good sessions from the digest. Resolve dirs from the override at send time
  // so forecasts always reflect the spot's current directions, mirroring the
  // app's own precedence (index.html: override dirs win when non-empty).
  const { data: overrides } = await supabase
    .from('spot_overrides')
    .select('name,dirs')
    .eq('active', true)
  const overrideDirs = new Map<string, number[]>()
  for (const o of overrides ?? []) {
    if (o.dirs?.length) overrideDirs.set(o.name, o.dirs)
  }

  const wxCache = new Map<string, any>()
  let sent = 0

  for (const email of emails) {
    const userFavs = favsByEmail.get(email) ?? []
    if (!userFavs.length) continue

    const APP_BASE = 'https://tomguiz.github.io/kiteforecast/'

    // Email CTAs use plain app URLs (not single-use magic links): magic links get
    // pre-consumed by email link-scanners and expire, breaking the CTA. The app
    // restores the user's saved session on load, so returning users land signed-in.
    async function magicLink(redirectTo: string): Promise<string> {
      return redirectTo
    }

    const spotForecasts = []
    for (const fav of userFavs) {
      const key = `${fav.spot_lat},${fav.spot_lon}`
      if (!wxCache.has(key)) {
        try { wxCache.set(key, await fetchForecast(fav.spot_lat, fav.spot_lon)) }
        catch { wxCache.set(key, null) }
      }
      const wx = wxCache.get(key)
      if (!wx) continue
      const dirs = overrideDirs.get(fav.spot_name) ?? fav.spot_dirs ?? []
      const sessions = getGoodSessions(wx, dirs, fav.spot_days ?? null)
      // Attach per-session magic links
      const sessionsWithLinks = await Promise.all(sessions.map(async sess => {
        const forecastUrl = `${APP_BASE}?spot=${encodeURIComponent(fav.spot_name)}&date=${sess.date}`
        const joinPayload = btoa(JSON.stringify({ spot: fav.spot_name, date: sess.date, start_time: sess.win_start.replace('h00', ':00') }))
        const joinUrl = `${APP_BASE}?join=${joinPayload}`
        return {
          ...sess,
          forecast_link: await magicLink(forecastUrl),
          join_link:     await magicLink(joinUrl),
        }
      }))
      if (sessionsWithLinks.length) {
        spotForecasts.push({ spot: fav.spot_name, sessions: sessionsWithLinks })
      }
    }

    const totalSessions = spotForecasts.reduce((s, sf) => s + sf.sessions.length, 0)
    const weekStart = new Date().toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })

    // Magic link for the main CTA (app home)
    const homeLink = await magicLink(APP_BASE)

    const spotsHtml = spotForecasts.slice(0, 10).map(sf => {
      const sessionRows = sf.sessions.map((sess: any) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;background-color:#1a2235;border:1px solid #242d42;border-radius:10px;">
          <tr>
            <td style="padding:14px 18px 10px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <!-- Date -->
                  <td style="vertical-align:middle;width:50%;">
                    <p style="margin:0;font-family:'Bebas Neue',Arial,sans-serif;font-size:20px;color:#ffffff;letter-spacing:1px;">${sess.day_of_week}</p>
                    <p style="margin:2px 0 0 0;font-size:11px;color:#4a5568;">${sess.date_label}</p>
                  </td>
                  <!-- Avg wind -->
                  <td style="vertical-align:middle;text-align:center;width:17%;">
                    <p style="margin:0;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#4a5568;">Avg</p>
                    <p style="margin:3px 0 0 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#5dd4f0;line-height:1;">${sess.avg_kn}<span style="font-size:11px;color:#4a5568;"> kn</span></p>
                  </td>
                  <!-- Gusts -->
                  <td style="vertical-align:middle;text-align:center;width:17%;">
                    <p style="margin:0;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#4a5568;">Gusts</p>
                    <p style="margin:3px 0 0 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#94a3b8;line-height:1;">${sess.max_gust}<span style="font-size:11px;color:#4a5568;"> kn</span></p>
                  </td>
                  <!-- Direction -->
                  <td style="vertical-align:middle;text-align:center;width:16%;">
                    <p style="margin:0;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#4a5568;">Dir</p>
                    <p style="margin:3px 0 0 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#4ade80;line-height:1;">${sess.dom_dir}</p>
                    <p style="margin:0;font-size:13px;color:#4ade80;">${sess.dir_arrow}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Best window bar -->
          <tr>
            <td style="padding:0 18px 10px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.2);border-radius:8px;padding:8px 14px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:middle;">
                          <span style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(74,222,128,.6);">&#9201; Best window</span>
                        </td>
                        <td style="vertical-align:middle;text-align:right;">
                          <span style="font-family:'Bebas Neue',Arial,sans-serif;font-size:18px;color:#4ade80;letter-spacing:1px;">${sess.win_start} &ndash; ${sess.win_end}</span>
                          <span style="font-size:11px;color:rgba(74,222,128,.6);margin-left:6px;">${sess.win_hours}h</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Session CTAs -->
          <tr>
            <td style="padding:0 18px 14px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:50%;padding-right:5px;">
                    <a href="${sess.forecast_link}" style="display:block;text-align:center;background:rgba(93,212,240,.12);border:1px solid rgba(93,212,240,.3);border-radius:8px;padding:9px 12px;font-family:'DM Sans',Arial,sans-serif;font-size:12px;font-weight:700;color:#5dd4f0;text-decoration:none;">&#128202; View forecast</a>
                  </td>
                  <td style="width:50%;padding-left:5px;">
                    <a href="${sess.join_link}" style="display:block;text-align:center;background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.3);border-radius:8px;padding:9px 12px;font-family:'DM Sans',Arial,sans-serif;font-size:12px;font-weight:700;color:#4ade80;text-decoration:none;">&#127689; I&rsquo;m going!</a>
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

    // Footer CTA rendered here (not mapped in Make) so the button always has a
    // valid href — a previously empty Make field left the button dead.
    const ctaHtml = `
      <a href="${homeLink}" style="display:inline-block;background:#2f6df6;border-radius:10px;padding:14px 28px;font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">&#128202; Check the full forecast</a>`

    const payload = {
      notification_type: 'digest',
      email,
      week_start: weekStart,
      total_good_sessions: totalSessions,
      has_sessions: totalSessions > 0,
      spots_html: spotsHtml,
      no_sessions_html: noSessionsHtml,
      home_link: homeLink,
      cta_html: ctaHtml,
    }

    await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    sent++
  }

  return new Response(JSON.stringify({ sent, total_users: emails.length }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})
