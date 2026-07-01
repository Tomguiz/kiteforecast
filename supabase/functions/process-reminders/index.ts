import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY    = Deno.env.get('SB_SERVICE_ROLE_KEY')!
const MAKE_WEBHOOK_URL        = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'
const TWILIO_ACCOUNT_SID      = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const TWILIO_AUTH_TOKEN       = Deno.env.get('TWILIO_AUTH_TOKEN') ?? ''
const TWILIO_FROM_NUMBER      = Deno.env.get('TWILIO_FROM_NUMBER') ?? ''

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

const isSnowy = (code: number) => [71,73,75,77,85,86].includes(code)

function rateDay(gh: number, pk: number, code: number, badDir: boolean, peakDay: number): string {
  if ([82,95,96,99].includes(code))       return '❌ Storm ⚡'
  if (gh === 0) {
    if (isRainy(code) && peakDay >= 10)   return isSnowy(code) ? '❌ ❄️ Snow' : '❌ 🌧 Rain'
    if (badDir && peakDay >= 15)          return '❌ Wrong direction'
    if (peakDay >= 10)                    return '❌ Too light'
    return '❌ No wind'
  }
  if (gh === 1)  return '❌ Too brief (1h)'
  if (gh === 2)  return `✅ 2h · ${pk}kn`
  if (gh <= 4) {
    if (pk >= 25) return `✅ ${gh}h · 25+ kn`
    if (pk >= 20) return `✅ ${gh}h · 20+ kn`
    return `✅ ${gh}h · 15+ kn`
  }
  if (pk >= 25) return `✅ ${gh}h · Perfect! 🪁`
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

  // Cache profiles.notifs_enabled per email so a paused user with many due
  // reminders is only looked up once. Missing profile → treated as enabled.
  const notifsEnabledCache = new Map<string, boolean>()
  async function notifsEnabled(email: string): Promise<boolean> {
    if (notifsEnabledCache.has(email)) return notifsEnabledCache.get(email)!
    const { data } = await supabase
      .from('profiles').select('notifs_enabled').eq('email', email).single()
    const enabled = data?.notifs_enabled !== false
    notifsEnabledCache.set(email, enabled)
    return enabled
  }

  for (const r of reminders ?? []) {
    try {
      // Master toggle: user paused all spot reminders — skip without emailing.
      if (!(await notifsEnabled(r.email))) {
        await supabase.from('reminders').update({ sent: true, skipped: true }).eq('id', r.id)
        continue
      }

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
        // Date no longer in 10-day window — mark skipped, no email sent
        await supabase.from('reminders').update({ sent: true, skipped: true }).eq('id', r.id)
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

      const isGoodNow = goodHours >= 2

      // ── Decide whether to send ────────────────────────────────────────────
      // Rule 1: 72h reminder — only send if forecast is currently good
      // Rule 2: shorter reminders — send if 72h was already sent (keep user
      //         informed even if forecast degraded), OR if forecast is good now
      //         (last-minute good session that had no 72h)
      const rh = r.reminder_hours as number
      if (rh === 72 && !isGoodNow) {
        // Bad forecast at 72h — mark skipped (not emailed) so follow-up reminders
        // don't treat this as a successful send
        await supabase.from('reminders').update({ sent: true, skipped: true }).eq('id', r.id)
        continue
      }

      if (rh !== 72 && !isGoodNow) {
        // Check if 72h was actually emailed (sent=true AND skipped=false/null)
        const { data: sent72 } = await supabase
          .from('reminders')
          .select('id')
          .eq('email', r.email)
          .eq('spot_name', r.spot_name)
          .eq('session_date', r.session_date)
          .eq('notif_type', r.notif_type)
          .eq('reminder_hours', 72)
          .eq('sent', true)
          .eq('skipped', false)
          .limit(1)

        if (!sent72 || sent72.length === 0) {
          // 72h was never emailed and forecast is bad — skip this one too
          await supabase.from('reminders').update({ sent: true, skipped: true }).eq('id', r.id)
          continue
        }
        // 72h was actually emailed → fall through and send this reminder (forecast update)
      }
      // ─────────────────────────────────────────────────────────────────────

      const rating          = rateDay(goodHours, peakKn, code, hasBadDir, peakDayKn)
      // When forecast degraded (no qualifying hours), fall back to all daylight hours for wind stats
      const sample          = good.length ? good : day
      const sessionStart    = good.length ? `${r.session_date}T${String(good[0].hour).padStart(2,'0')}:00` : `${r.session_date}T10:00`
      const sessionEnd      = good.length ? `${r.session_date}T${String(good[good.length-1].hour).padStart(2,'0')}:00` : ''
      const gusts           = sample.length ? Math.max(...sample.map(h => h.gustKn)) : 0
      const windMin         = sample.length ? Math.min(...sample.map(h => h.kn))     : 0
      const consistencyPct  = day.length  ? Math.round(good.length / day.length * 100) : 0

      // ── Calendar block — emits a <tr> to slot into the outer email table ──
      const fmtCal = (iso: string) => iso.replace(/[-:]/g, '').slice(0, 15)
      const calStart = fmtCal(sessionStart)
      const calEndIso = sessionEnd && sessionEnd !== sessionStart ? sessionEnd : `${r.session_date}T${String(good.length ? good[good.length-1].hour + 1 : 18).padStart(2,'0')}:00`
      const calEnd   = fmtCal(calEndIso)
      const startFmt = sessionStart.slice(11, 16)
      const endFmt   = calEndIso.slice(11, 16)
      const calTitle = encodeURIComponent(`Kite session - ${r.spot_name}`)
      const calDesc  = encodeURIComponent(`${peakKn}kn · ${goodHours}h of good wind. Forecast: ${r.app_link}`)
      const calLoc   = encodeURIComponent(r.spot_name)
      // &amp; because this HTML is injected directly into the email body
      const gcalUrl  = `https://calendar.google.com/calendar/render?action=TEMPLATE&amp;text=${calTitle}&amp;dates=${calStart}/${calEnd}&amp;details=${calDesc}&amp;location=${calLoc}`
      // Outlook web calendar link (works in all email clients, no data: URI needed)
      const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${calTitle}&startdt=${sessionStart}&enddt=${calEndIso}&location=${calLoc}&body=${calDesc}`
      const calendar_html = `<tr>
          <td style="background-color:#0f1520;border:1px solid #1e2535;border-top:none;padding:16px 32px;">
            <p style="margin:0 0 10px 0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4a5568;">&#128197; Block your agenda</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="49%" style="padding-right:6px;">
                  <a href="${gcalUrl}" style="display:block;text-align:center;background-color:#1a2235;border:1px solid #242d42;border-radius:8px;padding:11px 14px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;font-weight:700;color:#5dd4f0;text-decoration:none;">&#128197; Google Calendar</a>
                </td>
                <td width="2%"></td>
                <td width="49%" style="padding-left:6px;">
                  <a href="${outlookUrl}" style="display:block;text-align:center;background-color:#1a2235;border:1px solid #242d42;border-radius:8px;padding:11px 14px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;font-weight:700;color:#94a3b8;text-decoration:none;">&#128197; Apple / Outlook</a>
                </td>
              </tr>
            </table>
            <p style="margin:8px 0 0 0;font-size:11px;color:#4a5568;text-align:center;">&#8220;Kite session &#8212; ${r.spot_name}&#8221; &middot; ${startFmt}&ndash;${endFmt}</p>
          </td>
        </tr>`

      const payload = {
        notification_type:  r.notif_type,
        reminder_label:     rh === 1 ? '1 hour before' : `${rh} hours before`,
        email:              r.email,
        spot:               r.spot_name,
        spot_city:          r.spot_city,
        spot_country:       r.spot_country,
        spot_map_link:      r.spot_map_link,
        date:               r.session_date,
        day_of_week:        new Date(r.session_date + 'T12:00:00').toLocaleDateString('en', { weekday: 'long' }),
        date_label:         fmtDateLabel(r.session_date),
        app_link:           r.app_link,
        calendar_html,
        session: {
          start_time:           sessionStart,
          end_time:             sessionEnd,
          start_time_formatted: sessionStart.slice(11, 16),
          end_time_formatted:   sessionEnd ? sessionEnd.slice(11, 16) : '',
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

      // SMS via Twilio — premium users only, 1h reminder only
      if (rh === 1 && TWILIO_ACCOUNT_SID) {
        const { data: prof } = await supabase
          .from('profiles').select('is_premium,sms_enabled,phone_number')
          .eq('email', r.email).single()
        if (prof?.is_premium && prof?.sms_enabled && prof?.phone_number) {
          const sessionLabel = goodHours >= 2
            ? `${payload.session.start_time_formatted}–${payload.session.end_time_formatted} · ${peakKn}kn`
            : rating
          const smsBody = `🪁 Kite alert — ${r.spot_name} · ${payload.day_of_week} ${sessionLabel}. 1h before your session. tichkes.com`
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
          const form = new URLSearchParams({ From: TWILIO_FROM_NUMBER, To: prof.phone_number, Body: smsBody })
          await fetch(twilioUrl, {
            method: 'POST',
            headers: { 'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form,
          }).catch(e => console.error('Twilio error', e))
        }
      }

      const update: Record<string, unknown> = { sent: true }
      if (rh === 1) {
        const sessionStats = {
          session_peak_kn:  peakKn,
          session_min_kn:   windMin,
          session_hours:    goodHours,
          session_rating:   rating,
          session_wind_dir: domDir !== null ? compass(domDir) : null,
        }
        Object.assign(update, sessionStats)
        // Also write ground-truth wind onto the confirmed-session row (the Stats
        // source of truth) if the user actually confirmed they were going.
        await supabase.from('session_attendances').update(sessionStats)
          .eq('email', r.email).eq('spot_name', r.spot_name).eq('session_date', r.session_date)
      }
      await supabase.from('reminders').update(update).eq('id', r.id)
      processed++
    } catch (e) {
      console.error('Failed to process reminder', r.id, e)
    }
  }

  return new Response(JSON.stringify({ processed, total: reminders?.length ?? 0 }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
