import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderTemplate, renderSubject } from '../../supabase/functions/_shared/mailer.ts'

// Make.com rendered these templates with a nested replace() chain. Moving the
// send in-house means reproducing that faithfully — a placeholder the renderer
// does not understand ships as literal "[[spot]]" to a real inbox.

describe('rendering a template the way Make did', () => {
  it('fills flat placeholders', () => {
    const { html, missing } = renderTemplate('<p>[[spot]] on [[date_label]]</p>',
      { spot: 'Riverwoods', date_label: 'Sunday, August 30' })
    expect(html).toBe('<p>Riverwoods on Sunday, August 30</p>')
    expect(missing).toEqual([])
  })

  it('resolves the dotted paths the reminder templates use', () => {
    const { html } = renderTemplate('[[session.wind_speed_peak_kn]] kts [[conditions.sunrise]]',
      { session: { wind_speed_peak_kn: 24 }, conditions: { sunrise: '06:56' } })
    expect(html).toBe('24 kts 06:56')
  })

  it('empties an unresolved placeholder rather than shipping the markup', () => {
    const { html, missing } = renderTemplate('a[[nope]]b[[session.gone]]c', { session: {} })
    expect(html).toBe('abc')
    expect(missing).toEqual(['nope', 'session.gone'])
  })

  it('does not trip over a missing parent object', () => {
    const { html, missing } = renderTemplate('[[session.wind_speed_peak_kn]]', {})
    expect(html).toBe('')
    expect(missing).toEqual(['session.wind_speed_peak_kn'])
  })

  it('renders 0 and false, which are values, not absences', () => {
    const { html, missing } = renderTemplate('[[a]]|[[b]]',
      { a: 0, b: false })
    expect(html).toBe('0|false')
    expect(missing).toEqual([])
  })

  it('renders subjects with the same rules', () => {
    expect(renderSubject('🔔 Tomorrow at [[spot]] — [[session.wind_speed_peak_kn]] kts',
      { spot: 'Knokke', session: { wind_speed_peak_kn: 22 } }))
      .toBe('🔔 Tomorrow at Knokke — 22 kts')
  })
})

describe('against the real templates', () => {
  const read = (n: string) => readFileSync(new URL(`../../emails/${n}.html`, import.meta.url), 'utf8')

  // The payload process-reminders builds, in the shape the templates address.
  const payload = {
    reminder_label: '24 hours before', spot: 'Riverwoods Beachclub',
    spot_city: 'Knokke-Heist', spot_country: 'Belgium',
    spot_map_link: 'https://maps.example/x', date: '2026-08-30',
    day_of_week: 'Sunday', date_label: 'Sunday, August 30, 2026',
    app_link: 'https://app/x', manage_link: 'https://app/y',
    calendar_html: '<a>cal</a>', live_html: '',
    user_good_wind_dirs: ['SW', 'W'],
    session: {
      start_time: '2026-08-30T09:00', end_time: '2026-08-30T13:00',
      start_time_formatted: '09:00', end_time_formatted: '13:00',
      duration_hours: 4, wind_speed_peak_kn: 22, wind_speed_avg_kn: 19, wind_speed_min_kn: 16,
      wind_gusts_kn: 28, wind_direction: 'SW', wind_consistency_pct: 81,
      rating: '✅ 4h · Good',
      rating_fg: '#4ade80', rating_bg: 'rgba(34,197,94,.16)', rating_border: 'rgba(34,197,94,.34)',
    },
    conditions: {
      weather: 'Partly cloudy', temperature_max_c: 20, temperature_min_c: 15,
      sunrise: '06:56', sunset: '20:38', daylight_hours: 13,
    },
  }

  for (const name of ['reminderON24', 'reminderOFF24']) {
    it(`${name} renders with nothing left unfilled`, () => {
      const { html, missing } = renderTemplate(read(name), payload)
      expect(missing).toEqual([])
      expect(html).not.toMatch(/\[\[/)     // no literal markup reaches the inbox
      expect(html).toContain('Riverwoods Beachclub')
    })
  }
})

describe('the cutover is a secret, not a deploy', () => {
  const sender = readFileSync(
    new URL('../../supabase/functions/process-reminders/index.ts', import.meta.url), 'utf8')
  const mailer = readFileSync(
    new URL('../../supabase/functions/_shared/mailer.ts', import.meta.url), 'utf8')

  it('keeps the Make path for when the key is not set', () => {
    // Deploying must change nothing on its own: without RESEND_API_KEY,
    // mailerReady() is false and deliver() falls back to the webhook. Setting
    // the key is the cutover; clearing it is the rollback, for every email
    // type at once.
    expect(mailer).toContain('if (mailerReady() && d)')
    expect(mailer).toContain('opts.makeWebhookUrl')
    expect(sender).toContain('makeWebhookUrl: MAKE_WEBHOOK_URL')
  })

  it('does not record a delivery that failed', () => {
    // A failed send must leave the row unsent so the next run retries, rather
    // than logging a phantom email.
    const sendIdx   = sender.indexOf('await deliver(payload')
    const failIdx   = sender.indexOf('if (!sent.ok)')
    const recordIdx = sender.indexOf('await recordEmail(')
    expect(sendIdx).toBeGreaterThan(-1)
    expect(failIdx).toBeGreaterThan(sendIdx)
    expect(recordIdx).toBeGreaterThan(failIdx)
    expect(sender.slice(failIdx, recordIdx)).toContain('continue')
  })

  it('records which route the email actually took', () => {
    expect(sender).toContain('const via = sent.via')
    expect(sender).toMatch(/hours_before: rh, via/)
  })
})
