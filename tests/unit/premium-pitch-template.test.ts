import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Same guard as the onboarding template: the sender fills one [[placeholder]]
// at a time and nothing else checks that the function's payload and the
// template agree. A mismatch mails people literal [[markup]].

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const template = read('../../emails/premium-pitch.html')
const fnSource = read('../../supabase/functions/onboarding/index.ts')

const CONTRACT = ['nickname', 'app_link', 'upgrade_link', 'hook_html', 'unsubscribe_link'] as const

const placeholdersIn = (s: string) =>
  [...new Set((s.match(/\[\[([a-z_]+)\]\]/g) ?? []).map(m => m.slice(2, -2)))].sort()

describe('premium-pitch template/payload contract', () => {
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

  it('puts the personalised hook above the generic feature list', () => {
    expect(template.indexOf('[[hook_html]]')).toBeGreaterThan(-1)
    expect(template.indexOf('[[hook_html]]')).toBeLessThan(template.indexOf('[[upgrade_link]]'))
  })

  it('never uses the html block as an href, which would be empty-ish', () => {
    expect(template).not.toContain('href="[[hook_html]]"')
  })

  // Edge functions cannot serve HTML on this domain, so the opt-out goes
  // through the static page, same as the welcome email.
  it('links unsubscribe through the static page', () => {
    expect(fnSource).toContain('unsubscribe.html?t=')
    expect(fnSource).not.toContain('/functions/v1/unsubscribe?t=')
  })

  // This is the email that asks for money, so the number in it has to be the
  // number the checkout button charges.
  it('prices premium the same as the in-app checkout button', () => {
    expect(read('../../index.html')).toContain('19.99')
    expect(template).toContain('19.99')
  })

  // "One payment, no subscription" is the strongest thing about the offer and
  // also a promise — losing it from the copy would misrepresent the product.
  it('says the payment is one-off', () => {
    expect(template).toMatch(/not a subscription/i)
  })

  // Every feature it pitches must be one the app actually gates behind premium.
  // The app's own PREMIUM_FEATURES list is the source of truth.
  it('pitches only features the app really gates', () => {
    const app = read('../../index.html')
    for (const label of [
      'Unlimited fav spots', 'Weekly wind digest', 'Tide times',
      'Session tracking', 'Priority support',
    ]) {
      expect(app, `index.html no longer lists "${label}" as premium`).toContain(label)
    }
    // …and the email names each of them in its own words.
    for (const claim of ['Every spot', 'Monday', 'Tide times', 'riding history', 'Priority support']) {
      expect(template, `template no longer mentions "${claim}"`).toContain(claim)
    }
  })
})

describe('the two lifecycle emails stay two weeks apart', () => {
  it('sends the pitch at 14 days, well after the 24h welcome', () => {
    expect(fnSource).toContain('minAgeHours: 14 * 24')
    expect(fnSource).toContain('minAgeHours: 24')
  })

  // A rider who already paid must never be sold to again — it reads as the app
  // not knowing who they are.
  it('skips riders who are already premium', () => {
    expect(fnSource).toContain("skip: 'already premium'")
  })

  // Both of these are scheduled marketing, not a notification the rider asked
  // for, so an unsubscribe has to stop them.
  it('respects an unsubscribe', () => {
    expect(fnSource).toContain('notifs_enabled === false')
  })
})
