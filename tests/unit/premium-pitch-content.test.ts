import { describe, it, expect } from 'vitest'
import {
  resolvePremiumStage, buildPremiumHookHtml, type PremiumLinks,
} from '../../supabase/functions/onboarding/premium-content.ts'

const LINKS: PremiumLinks = {
  app:     'https://app.test/',
  upgrade: 'https://app.test/?tab=profile',
}

describe('resolvePremiumStage', () => {
  it('leads with friends when the rider has any', () => {
    expect(resolvePremiumStage({ reminderCount: 0, friendCount: 2 }))
      .toBe('has_friends')
  })

  // Friends are the more specific signal: you only add riders you actually ride
  // with, so it wins even when alerts would also apply.
  it('prefers the friends angle over the alerts angle', () => {
    expect(resolvePremiumStage({ reminderCount: 9, friendCount: 1 }))
      .toBe('has_friends')
  })

  it('falls back to the digest angle for a rider who only sets alerts', () => {
    expect(resolvePremiumStage({ reminderCount: 3, friendCount: 0 }))
      .toBe('active_alerts')
  })

  it('pitches the spot limit when there is nothing to infer', () => {
    expect(resolvePremiumStage({ reminderCount: 0, friendCount: 0 }))
      .toBe('default')
  })

  it('does not trust negative or junk counts', () => {
    expect(resolvePremiumStage({ reminderCount: -1, friendCount: -5 }))
      .toBe('default')
    expect(resolvePremiumStage({ reminderCount: NaN as any, friendCount: NaN as any, })).toBe('default')
  })
})

describe('buildPremiumHookHtml', () => {
  const STATES = [
    { reminderCount: 0, friendCount: 0 },
    { reminderCount: 2, friendCount: 0 },
    { reminderCount: 2, friendCount: 4 },
  ]

  it('always renders something', () => {
    for (const state of STATES) {
      expect(buildPremiumHookHtml(state, LINKS, 'Sam').length).toBeGreaterThan(200)
    }
  })

  // Every stage of this email exists to sell, so every stage must offer the way
  // to buy. A hook with no upgrade link is a wasted send.
  it('always points at the upgrade link', () => {
    for (const state of STATES) {
      expect(buildPremiumHookHtml(state, LINKS, 'Sam')).toContain(LINKS.upgrade)
    }
  })

  it('names the rider', () => {
    for (const state of STATES) {
      expect(buildPremiumHookHtml(state, LINKS, 'Sam')).toContain('Sam')
    }
  })

  it('counts friends in words a human would use', () => {
    const one  = buildPremiumHookHtml({ reminderCount: 0, friendCount: 1 }, LINKS, 'Sam')
    const many = buildPremiumHookHtml({ reminderCount: 0, friendCount: 4 }, LINKS, 'Sam')
    expect(one).toContain('a rider')
    expect(many).toContain('4 riders')
  })

  it('counts alerts the same way', () => {
    const one  = buildPremiumHookHtml({ reminderCount: 1, friendCount: 0 }, LINKS, 'Sam')
    const many = buildPremiumHookHtml({ reminderCount: 3, friendCount: 0 }, LINKS, 'Sam')
    expect(one).toContain('set an alert')
    expect(many).toContain('set 3 alerts')
  })

  // A nickname comes from a free-text profile field and lands inside markup.
  it('escapes the nickname', () => {
    const html = buildPremiumHookHtml(STATES[0], LINKS, '<script>x</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('leaves no unfilled placeholder behind', () => {
    for (const state of STATES) {
      expect(buildPremiumHookHtml(state, LINKS, 'Sam')).not.toMatch(/\[\[/)
    }
  })
})
