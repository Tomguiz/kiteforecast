import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Same guard as the what's-new template: Make renders this by replacing one
// [[placeholder]] at a time, and nothing else checks that the function's payload
// and the template agree. A mismatch mails people literal [[markup]].

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const template = read('../../emails/onboarding.html')
const fnSource = read('../../supabase/functions/onboarding/index.ts')

const CONTRACT = ['nickname', 'app_link', 'upgrade_link', 'next_step_html', 'unsubscribe_link'] as const

const placeholdersIn = (s: string) =>
  [...new Set((s.match(/\[\[([a-z_]+)\]\]/g) ?? []).map(m => m.slice(2, -2)))].sort()

describe('onboarding template/payload contract', () => {
  it('uses exactly the placeholders in the contract', () => {
    expect(placeholdersIn(template)).toEqual([...CONTRACT].sort())
  })

  it('sends every contracted field from the edge function', () => {
    for (const key of CONTRACT) {
      expect(fnSource, `payload is missing "${key}"`).toContain(`${key}:`)
    }
  })

  it('carries an unsubscribe link, since this is unsolicited mail', () => {
    expect(template).toContain('[[unsubscribe_link]]')
  })

  it('puts the personalised next step above the generic feature tour', () => {
    expect(template.indexOf('[[next_step_html]]')).toBeGreaterThan(-1)
    expect(template.indexOf('[[next_step_html]]')).toBeLessThan(template.indexOf('[[app_link]]'))
  })

  it('never uses the html block as an href, which would be empty-ish', () => {
    expect(template).not.toContain('href="[[next_step_html]]"')
  })

  // The onboarding email points riders at the unsubscribe *page*, not the
  // function — edge functions cannot serve HTML on this domain.
  it('links unsubscribe through the static page', () => {
    expect(fnSource).toContain('unsubscribe.html?t=')
    expect(fnSource).not.toContain('/functions/v1/unsubscribe?t=')
  })

  // Premium claims must match the app's own feature list (index.html), or the
  // first email a rider gets is already lying to them.
  it('prices premium the same as the in-app checkout button', () => {
    const app = read('../../index.html')
    expect(app).toContain('19.99')
    expect(template).toContain('19.99')
  })
})
