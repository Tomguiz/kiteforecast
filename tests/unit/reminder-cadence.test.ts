import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// One rider watching one spot received 35 emails in a week: the ladder was
// [72,48,24,6,1], so five emails per session date, for seven consecutive days.
// That is indistinguishable from spam, and it is the kind of thing that gets a
// sending domain blocked.

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const creator = read('../../supabase/functions/check-new-sessions/index.ts')
const sender = read('../../supabase/functions/process-reminders/index.ts')

describe('one email per rider, per spot, per session', () => {
  it('schedules only the 24h reminder for emailing', () => {
    const m = creator.match(/const REMINDER_HOURS\s*=\s*\[([^\]]*)\]/)
    expect(m).toBeTruthy()
    const hours = m![1].split(',').map(s => Number(s.trim())).filter(Number.isFinite)
    expect(hours).toContain(24)
    // the noisy middle of the ladder is gone
    expect(hours).not.toContain(72)
    expect(hours).not.toContain(48)
    expect(hours).not.toContain(6)
  })

  it('still schedules the 1h row, which is not an email', () => {
    // It writes session_peak_kn and the ground-truth wind the Stats page reads,
    // and fires the premium SMS. Dropping it would quietly break Stats.
    const m = creator.match(/const REMINDER_HOURS\s*=\s*\[([^\]]*)\]/)!
    const hours = m[1].split(',').map(s => Number(s.trim())).filter(Number.isFinite)
    expect(hours).toContain(1)
    expect(sender).toMatch(/const REMINDER_EMAIL_HOURS\s*=\s*\[\s*24\s*\]/)
  })

  it('the sender gates the email, not the whole reminder', () => {
    // The stats write and the SMS must stay outside the email guard.
    const guardIdx = sender.indexOf('const sendEmail')
    const webhookIdx = sender.indexOf('await fetch(MAKE_WEBHOOK_URL')
    const statsIdx = sender.indexOf('session_peak_kn')
    const smsIdx = sender.indexOf('TWILIO_ACCOUNT_SID)')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(webhookIdx).toBeGreaterThan(guardIdx)   // the webhook sits inside the guard
    expect(statsIdx).toBeGreaterThan(webhookIdx)   // stats come after, ungated
    expect(smsIdx).toBeGreaterThan(webhookIdx)     // so does the SMS
  })

  it('dedupes on rider + spot + date, ignoring notif_type', () => {
    // A 'spot' and a 'day' reminder for the same spot on the same date are
    // still two emails about one session, so the key must not include the type.
    const block = sender.slice(sender.indexOf('const { data: priorEmail }'), sender.indexOf('alreadyToldThem ='))
    expect(block).toContain("eq('email'")
    expect(block).toContain("eq('spot_name'")
    expect(block).toContain("eq('session_date'")
    expect(block).toContain("eq('sent', true)")
    expect(block).toContain("eq('skipped', false)")
    expect(block).toContain("neq('id'")             // never matches itself
    expect(block).not.toContain('notif_type')
  })

  it('the degraded-forecast rule no longer asks about a step that is gone', () => {
    // It used to check specifically whether the 72h reminder had been emailed.
    // With 72h no longer scheduled that question always answered "no", which
    // would have silently suppressed every forecast-update email.
    expect(sender).not.toMatch(/reminder_hours['"]?\s*,\s*72/)
    expect(sender).toContain('if (!alreadyToldThem)')
  })
})
