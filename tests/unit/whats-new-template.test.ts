import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Make.com renders this email by GETting the template from main and running one
// replace() per [[placeholder]]. Nothing validates that the function's payload
// and the template's placeholders agree — a mismatch just mails people literal
// [[markup]], and there is no staging step to catch it. This is that check.

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const template = read('../../emails/whats-new.html')
const fnSource = read('../../supabase/functions/whats-new/index.ts')

// Every field Make must be configured to replace. Adding one here is a reminder
// that the Make scenario needs a matching replace() before the template merges.
const CONTRACT = [
  'nickname',
  'app_link',
  'home_setup_link',
  'personal_html',
  'your_spots_html',
  'unsubscribe_link',
] as const

const placeholdersIn = (s: string) =>
  [...new Set((s.match(/\[\[([a-z_]+)\]\]/g) ?? []).map(m => m.slice(2, -2)))].sort()

describe('whats-new template/payload contract', () => {
  it('uses exactly the placeholders in the contract', () => {
    expect(placeholdersIn(template)).toEqual([...CONTRACT].sort())
  })

  it('sends every contracted field from the edge function', () => {
    for (const key of CONTRACT) {
      expect(fnSource, `payload is missing "${key}"`).toContain(`${key}:`)
    }
  })

  it('keeps the unsubscribe link in the template, since this mails everyone', () => {
    expect(template).toContain('[[unsubscribe_link]]')
  })

  it('puts the personal block before the feature tour, not after the CTA', () => {
    expect(template.indexOf('[[personal_html]]')).toBeGreaterThan(-1)
    expect(template.indexOf('[[personal_html]]')).toBeLessThan(template.indexOf('[[app_link]]'))
  })

  it('leaves no placeholder inside an href where an empty value would break the link', () => {
    // [[app_link]], [[home_setup_link]] and [[unsubscribe_link]] are always
    // populated; the *_html blocks must never be used as an href, because they
    // are empty for some riders and an empty href reloads the current page.
    for (const block of ['personal_html', 'your_spots_html']) {
      expect(template).not.toContain(`href="[[${block}]]"`)
    }
  })
})
