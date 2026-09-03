import { describe, it, expect } from 'vitest'
import { sessionHype, isHot, whenWord, HOT_TIERS } from '../../supabase/functions/_shared/hype.ts'
import { reminderDelivery } from '../../supabase/functions/_shared/mailer.ts'

const ctx = { spot: 'Riverwoods Beachclub', avgKn: 31, peakKn: 34, goodHours: 5, dir: 'SW', when: 'tomorrow' }

describe('which days are fire', () => {
  it('Very Good, Epic and Expert mode are; Good and below are not', () => {
    expect(HOT_TIERS).toEqual(['expert', 'epic', 'verygood'])
    for (const t of ['expert', 'epic', 'verygood']) expect(isHot(t), t).toBe(true)
    for (const t of ['good', 'chill', 'lightwind', 'rain', 'nowind']) expect(isHot(t), t).toBe(false)
  })

  it('the 24h reminder picks the fire template for a hot day and the plain one otherwise', () => {
    expect(reminderDelivery(24, true, true).template).toBe('reminderFIRE24')
    expect(reminderDelivery(24, true, false).template).toBe('reminderON24')
    expect(reminderDelivery(24, false, true).template).toBe('reminderOFF24')   // off is off, however hot the label
    // the tease is per tier, so the subject comes from the payload
    expect(reminderDelivery(24, true, true).subject).toBe('[[hype.subject]]')
    expect(reminderDelivery(24, true, false).subject).toBe('[[hype.subject]]')
  })

  it('other ladder steps have no fire template and fall back to their ON one', () => {
    expect(reminderDelivery(1, true, true).template).toBe('reminderON1')
  })
})

describe('sessionHype', () => {
  it('every session tier gets a subject, a two-line headline and a tease', () => {
    for (const t of ['expert', 'epic', 'verygood', 'good', 'chill', 'lightwind']) {
      const h = sessionHype(t, ctx)
      for (const k of ['subject', 'title', 'title_accent', 'tease'] as const) expect(h[k].length, `${t}.${k}`).toBeGreaterThan(0)
      expect(h.fire).toBe(isHot(t))
    }
  })

  it('the tease carries the numbers the rating is built on', () => {
    const h = sessionHype('epic', ctx)
    expect(h.tease).toContain('31 knots on average')
    expect(h.tease).toContain('5 hours')
    expect(h.tease).toContain('SW')
    expect(h.tease).toContain('Riverwoods Beachclub')
    expect(h.subject).toContain('31 kts avg')
  })

  it('a hot day sounds like one, a chill day does not overpromise', () => {
    expect(sessionHype('expert', ctx).subject).toMatch(/EXPERT MODE/)
    expect(sessionHype('epic', ctx).subject).toMatch(/EPIC/)
    expect(sessionHype('verygood', ctx).title_accent).toMatch(/very good/i)
    expect(sessionHype('chill', ctx).title_accent).toMatch(/chill/i)
    expect(sessionHype('chill', ctx).tease).not.toMatch(/epic/i)
    expect(sessionHype('good', ctx).tease).not.toMatch(/epic/i)
  })

  it('names the day the ladder step points at', () => {
    expect(whenWord(24, 'Saturday')).toBe('tomorrow')
    expect(whenWord(6, 'Saturday')).toBe('today')
    expect(whenWord(72, 'Saturday')).toBe('on Saturday')
    expect(sessionHype('epic', { ...ctx, when: 'on Saturday' }).title_accent).toBe('On Saturday is epic.')
  })

  it('escapes the spot name — it is user-supplied and lands in HTML', () => {
    const h = sessionHype('epic', { ...ctx, spot: '<b>Knokke</b> & co' })
    expect(h.tease).toContain('&lt;b&gt;Knokke&lt;/b&gt; &amp; co')
    expect(h.tease).not.toContain('<b>')
  })
})
