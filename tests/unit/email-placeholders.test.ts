import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Make.com renders these templates with a flat replace() chain and no
// conditionals, fetching them from `main` at send time — so merging a template
// IS deploying it. A placeholder the payload doesn't carry does not fail
// loudly; it emails literal [[markup]] to real people. This pins the two sides
// together so that can't merge.

const EMAILS = join(__dirname, '..', '..', 'emails')
const FN = join(__dirname, '..', '..', 'supabase', 'functions', 'process-reminders', 'index.ts')

const templates = readdirSync(EMAILS)
  .filter(f => f.startsWith('reminder') && f.endsWith('.html'))

function placeholders(file: string): string[] {
  const html = readFileSync(join(EMAILS, file), 'utf8')
  return [...new Set(html.match(/\[\[([^\]]+)\]\]/g) ?? [])].map(p => p.slice(2, -2))
}

// The payload is an object literal; its top-level keys are what Make.com can
// address, with nested objects reachable as `session.x` / `conditions.x`.
const fnSource = readFileSync(FN, 'utf8')

function payloadCarries(key: string): boolean {
  const root = key.split('.')[0]
  return new RegExp(`\\b${root}\\s*:`).test(fnSource) || new RegExp(`\\b${root},`).test(fnSource)
}

describe('reminder email placeholders', () => {
  it('finds all eleven reminder templates', () => {
    expect(templates).toHaveLength(11)
  })

  it.each(templates)('%s uses only placeholders the payload carries', file => {
    const unbacked = placeholders(file).filter(p => !payloadCarries(p))
    expect(unbacked).toEqual([])
  })

  // The spot was only named mid-sentence in the tease, and a rider skimming
  // the inbox missed which spot the email was about. It now sits directly
  // above the headline, with its town.
  it.each(templates)('%s names the spot right above the headline', file => {
    const html = readFileSync(join(EMAILS, file), 'utf8')
    const h1 = html.indexOf('<h1 ')
    const before = html.slice(Math.max(0, h1 - 600), h1)
    expect(before).toContain('[[spot]]')
    expect(before).toContain('[[spot_city]]')
  })

  it.each(templates)('%s has the manage-alert button', file => {
    expect(placeholders(file)).toContain('manage_link')
  })

  it('every template points the button at the notifications tab', () => {
    for (const file of templates) {
      const html = readFileSync(join(EMAILS, file), 'utf8')
      expect(html).toContain('href="[[manage_link]]"')
    }
  })
})

// The sponsor slot closes the digest, AFTER the reader's own call to action.
// It shipped the other way round for one send: you hit the Billy Kite block
// before "Check the full forecast", so the paid link came between the rider
// and the thing they opened the email for.
describe('digest section order', () => {
  const digest = readFileSync(new URL('../../emails/digest.html', import.meta.url), 'utf8')

  it('puts the forecast CTA before the deal slot', () => {
    const cta = digest.indexOf('Check the full forecast')
    const ad = digest.indexOf('[[ad_html]]')
    expect(cta).toBeGreaterThan(-1)
    expect(ad).toBeGreaterThan(-1)
    expect(cta).toBeLessThan(ad)
  })

  it('still keeps the sessions above both of them', () => {
    expect(digest.indexOf('[[spots_html]]')).toBeLessThan(digest.indexOf('Check the full forecast'))
    expect(digest.indexOf('[[nearby_html]]')).toBeLessThan(digest.indexOf('Check the full forecast'))
  })
})
