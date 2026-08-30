import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { DELIVERIES, reminderDelivery, renderTemplate } from '../../supabase/functions/_shared/mailer.ts'

const fnDir = new URL('../../supabase/functions/', import.meta.url)
const emailDir = new URL('../../emails/', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

// Every notifier used to POST its own payload at Make, which rendered the
// template and set the subject. Moving that in-house means the mapping has to
// live somewhere — and be checked, because a wrong template name is only
// discovered by a rider receiving the wrong email.

describe('every mapped delivery points at a template that exists', () => {
  const templates = new Set(
    readdirSync(emailDir).filter(f => f.endsWith('.html')).map(f => f.replace('.html', '')))

  for (const [kind, d] of Object.entries(DELIVERIES)) {
    it(`${kind} → ${d.template}.html`, () => {
      expect(templates.has(d.template)).toBe(true)
    })
  }

  it('the reminder steps that still email resolve to real templates', () => {
    for (const on of [true, false]) {
      const d = reminderDelivery(24, on)
      expect(templates.has(d.template)).toBe(true)
      expect(d.subject).not.toContain('undefined')
    }
  })
})

describe('every notifier goes through the one door', () => {
  const senders = readdirSync(fnDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name)
    .filter(n => {
      try { return read(`../../supabase/functions/${n}/index.ts`).includes('hook.eu1.make.com') }
      catch { return false }
    })

  for (const name of senders) {
    it(`${name} calls deliver() rather than fetching the webhook itself`, () => {
      const src = read(`../../supabase/functions/${name}/index.ts`)
      // The URL may still be referenced — it is passed to deliver() as the
      // fallback — but nothing should POST to it directly any more.
      expect(src).toMatch(/deliver\(/)
      expect(src).not.toMatch(/fetch\(\s*MAKE_WEBHOOK_URL/)
    })
  }

  it('found the notifiers, rather than silently testing nothing', () => {
    expect(senders.length).toBeGreaterThanOrEqual(10)
  })
})

describe('subjects render against a realistic payload', () => {
  const samples: Record<string, Record<string, unknown>> = {
    digest:                { week_start: 'Aug 31' },
    whats_new:             {},
    friend_request:        { requester_nickname: 'Sam' },
    session_attendance:    { attendee_nickname: 'Guiz', spot_name: 'Riverwoods' },
    claim:                 { spot_name: 'Riverwoods' },
    claim_accepted:        { spot_name: 'Riverwoods' },
    spot_suggestion:       { spot_name: 'Riverwoods' },
    spot_update:           { spot_name: 'Riverwoods' },
    spot_request_approved: { spot_name: 'Riverwoods' },
    onboarding:            {},
  }
  for (const [kind, vars] of Object.entries(samples)) {
    it(`${kind} leaves no placeholder in its subject`, () => {
      const { html, missing } = renderTemplate(DELIVERIES[kind].subject, vars)
      expect(missing).toEqual([])
      expect(html).not.toMatch(/\[\[/)
      expect(html.length).toBeGreaterThan(3)
    })
  }
})

describe('the personal address is out of the emails', () => {
  it('no shipped function still defaults to the personal gmail', () => {
    const dirs = readdirSync(fnDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name)
    for (const d of dirs) {
      let src = ''
      try { src = read(`../../supabase/functions/${d}/index.ts`) } catch { continue }
      expect(src, `${d} still carries the personal address`).not.toContain('tom.guisgand@gmail.com')
    }
  })

  it('but the admin identity checks are untouched', () => {
    // These are not delivery addresses — they are who the admin IS. Rewriting
    // them would lock the owner out of the admin panel.
    expect(read('../../supabase/schema.sql')).toContain('tom.guisgand@gmail.com')
    expect(read('../../index.html')).toContain("!== 'tom.guisgand@gmail.com'")
  })
})
