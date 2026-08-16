import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchForecast, getGoodSessions } from './session-logic.ts'
import { selectNearbySpots, rankNearbySpots } from '../_shared/nearby.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')!
const MAKE_WEBHOOK_URL     = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Spot names come from the catalogue and home_label is user-supplied; both are
// interpolated into email HTML, so escape them.
const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  let emailFilter: string | null = null
  try { const body = await req.json(); emailFilter = body?.email_filter ?? null } catch { /* no body */ }

  let query = supabase.from('profiles')
    .select('email,home_lat,home_lon,home_label,digest_nearby_enabled,digest_nearby_km')
  if (emailFilter) {
    query = query.eq('email', emailFilter)
  } else {
    query = query.eq('digest_enabled', true)
  }
  const { data: profiles, error: profErr } = await query

  if (profErr) return new Response(JSON.stringify({ error: profErr.message }), { status: 500 })

  const emails = (profiles ?? []).map((p: any) => p.email)
  const profileByEmail = new Map<string, any>()
  for (const p of profiles ?? []) profileByEmail.set(p.email, p)
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

  // Catalogue for the "near you" section. Loaded once per run, not per user.
  // Only fetched when at least one user in this batch has the section on.
  const anyNearby = (profiles ?? []).some((p: any) =>
    p.digest_nearby_enabled && p.home_lat != null && p.home_lon != null)
  let catalogue: any[] = []
  if (anyNearby) {
    const { data: spotRows } = await supabase
      .from('spots').select('name,loc,lat,lon,dirs').eq('active', true)
    catalogue = spotRows ?? []
  }

  const wxCache = new Map<string, any>()
  let sent = 0

  for (const email of emails) {
    const userFavs = favsByEmail.get(email) ?? []
    // A user with no favourites can still want the digest: the "near you"
    // section stands on its own. Skip only when there is nothing to report
    // from either source.
    const prof = profileByEmail.get(email) ?? {}
    const nearbyOn = prof.digest_nearby_enabled === true
      && prof.home_lat != null && prof.home_lon != null
    if (!userFavs.length && !nearbyOn) continue

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

    // ── "Near you": good sessions at catalogue spots around the user's home ──
    // Uses the same getGoodSessions as favourites, so a day can never count as
    // rideable in one section and not the other.
    const nearbyForecasts: Array<{ spot: string; distanceKm: number; sessions: any[] }> = []
    if (prof.digest_nearby_enabled && prof.home_lat != null && prof.home_lon != null && catalogue.length) {
      const { selected, droppedByCap } = selectNearbySpots(
        catalogue,
        { lat: prof.home_lat, lon: prof.home_lon },
        {
          radiusKm: prof.digest_nearby_km ?? 120,
          exclude: userFavs.map((f: any) => ({ name: f.spot_name, lat: f.spot_lat, lon: f.spot_lon })),
          limit: 10,
        },
      )
      if (droppedByCap > 0) {
        console.log(`[digest] ${email}: ${droppedByCap} nearby spot(s) beyond the 10-spot cap were not checked`)
      }
      for (const s of selected) {
        const key = `${s.lat},${s.lon}`
        if (!wxCache.has(key)) {
          try { wxCache.set(key, await fetchForecast(s.lat, s.lon)) }
          catch { wxCache.set(key, null) }
        }
        const wx = wxCache.get(key)
        if (!wx) continue
        const dirs = overrideDirs.get(s.name) ?? s.dirs ?? []
        const sessions = getGoodSessions(wx, dirs, null)
        if (sessions.length) {
          nearbyForecasts.push({ spot: s.name, distanceKm: Math.round(s.distanceKm), sessions })
        }
      }
    }
    // Rank and cut to the best 5 (see Task 4b for rankNearbySpots).
    const ranked = rankNearbySpots(
      nearbyForecasts.map(f => ({
        ...f,
        peakKn:     f.sessions.reduce((m, x) => Math.max(m, x.max_gust ?? 0, x.avg_kn ?? 0), 0),
        totalHours: f.sessions.reduce((n, x) => n + (x.duration_hours ?? 0), 0),
      })),
      5,
    )
    if (ranked.droppedAsNotWorthTheDrive > 0) {
      console.log(`[digest] ${email}: ${ranked.droppedAsNotWorthTheDrive} nearby spot(s) dropped — too few rideable hours for the distance`)
    }
    if (ranked.droppedByLimit > 0) {
      console.log(`[digest] ${email}: ${ranked.droppedByLimit} nearby spot(s) cut by the best-5 report limit`)
    }
    nearbyForecasts.length = 0
    nearbyForecasts.push(...ranked.selected)

    const nearbyCount = nearbyForecasts.reduce((n, f) => n + f.sessions.length, 0)

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
            <p style="margin:0;font-family:'Bebas Neue',Arial,sans-serif;font-size:26px;color:#5dd4f0;letter-spacing:1px;">&#128205; ${escapeHtml(sf.spot)}</p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#141b27;border-left:1px solid #1e2535;border-right:1px solid #1e2535;padding:0 32px 20px 32px;">
            ${sessionRows}
          </td>
        </tr>`
    }).join('')

    const noSessionsHtml = (totalSessions + nearbyCount) === 0 ? `
      <tr>
        <td style="background-color:#141b27;border:1px solid #1e2535;border-top:none;padding:40px 32px;text-align:center;">
          <p style="margin:0 0 8px 0;font-size:32px;">&#128168;</p>
          <p style="margin:0 0 6px 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#4a5568;">No sessions this week</p>
          <p style="margin:0;font-size:13px;color:#4a5568;line-height:1.5;">We're keeping an eye on your spots.<br/>You'll hear from us when the wind picks up.</p>
        </td>
      </tr>` : ''

    // Rendered after favourites so the familiar part of the email never moves.
    const nearbyHtml = nearbyForecasts.length ? `
      <tr>
        <td style="background-color:#0f1520;border-left:1px solid #1e2535;border-right:1px solid #1e2535;border-top:1px solid #1e2535;padding:22px 32px 4px 32px;">
          <p style="margin:0 0 2px 0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4a5568;">Near you</p>
          <p style="margin:0;font-size:12px;color:#4a5568;">Not in your favourites &mdash; within ${prof.digest_nearby_km ?? 120}&nbsp;km of ${escapeHtml(prof.home_label || 'home')}</p>
        </td>
      </tr>
      ${nearbyForecasts.map(nf => `
      <tr>
        <td style="background-color:#0f1520;border-left:1px solid #1e2535;border-right:1px solid #1e2535;padding:14px 32px 0 32px;">
          <p style="margin:0;font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#5dd4f0;letter-spacing:1px;">&#128205; ${escapeHtml(nf.spot)}
            <span style="font-family:'DM Sans',Arial,sans-serif;font-size:11px;color:#4a5568;letter-spacing:0;">&nbsp;&middot;&nbsp;${nf.distanceKm} km away</span>
          </p>
        </td>
      </tr>
      <tr>
        <td style="background-color:#141b27;border-left:1px solid #1e2535;border-right:1px solid #1e2535;padding:0 32px 16px 32px;">
          ${nf.sessions.map((sess: any) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;background-color:#1a2235;border:1px solid #242d42;border-radius:10px;">
              <tr>
                <td style="padding:12px 16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="vertical-align:middle;width:52%;">
                        <p style="margin:0;font-family:'Bebas Neue',Arial,sans-serif;font-size:18px;color:#ffffff;letter-spacing:1px;">${sess.day_of_week}</p>
                        <p style="margin:2px 0 0 0;font-size:11px;color:#4a5568;">${sess.win_start} &ndash; ${sess.win_end} &middot; ${sess.win_hours}h</p>
                      </td>
                      <td style="vertical-align:middle;text-align:center;width:24%;">
                        <p style="margin:0;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#4a5568;">Avg</p>
                        <p style="margin:3px 0 0 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:20px;color:#5dd4f0;line-height:1;">${sess.avg_kn}<span style="font-size:11px;color:#4a5568;"> kn</span></p>
                      </td>
                      <td style="vertical-align:middle;text-align:center;width:24%;">
                        <p style="margin:0;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#4a5568;">Dir</p>
                        <p style="margin:3px 0 0 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:20px;color:#4ade80;line-height:1;">${sess.dom_dir} ${sess.dir_arrow}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>`).join('')}
        </td>
      </tr>`).join('')}` : ''

    // Footer CTA rendered here (not mapped in Make) so the button always has a
    // valid href — a previously empty Make field left the button dead.
    const ctaHtml = `
      <a href="${homeLink}" style="display:inline-block;background:#2f6df6;border-radius:10px;padding:14px 28px;font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">&#128202; Check the full forecast</a>`

    const payload = {
      notification_type: 'digest',
      email,
      week_start: weekStart,
      total_good_sessions: totalSessions,
      has_sessions: (totalSessions + nearbyCount) > 0,
      spots_html: spotsHtml,
      no_sessions_html: noSessionsHtml,
      nearby_html:  nearbyHtml,
      nearby_count: nearbyCount,
      has_nearby:   nearbyCount > 0,
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
