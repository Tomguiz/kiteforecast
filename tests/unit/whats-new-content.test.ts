import { describe, it, expect } from 'vitest'
import {
  resolveTier, buildPersonalHtml, buildLifetimeHtml,
  buildEarnedActiveHtml, buildEarnedExpiredHtml, buildYourSpotsHtml,
  type ProfileLike,
} from '../../supabase/functions/whats-new/content.ts'

const NOW = new Date('2026-08-19T12:00:00Z')
const OPTS = { replyTo: 'hello@example.com', upgradeUrl: 'https://app.test/?upgrade=1', now: NOW }

const profile = (over: Partial<ProfileLike> = {}): ProfileLike => ({
  email: 'rider@example.com', nickname: 'Rider', is_premium: false,
  premium_until: null, contribution_points: 0, ...over,
})

describe('resolveTier', () => {
  it('treats a paid profile as lifetime', () => {
    expect(resolveTier(profile({ is_premium: true }), NOW)).toBe('lifetime')
  })

  // The case that motivated the precedence rule: a lifetime customer who also
  // earned points must not be greeted as someone on a free month.
  it('keeps a paid profile lifetime even with points and a stale premium_until', () => {
    const p = profile({ is_premium: true, contribution_points: 15, premium_until: '2026-01-01T00:00:00Z' })
    expect(resolveTier(p, NOW)).toBe('lifetime')
  })

  it('keeps a paid profile lifetime even when premium_until is still in the future', () => {
    const p = profile({ is_premium: true, contribution_points: 5, premium_until: '2026-12-01T00:00:00Z' })
    expect(resolveTier(p, NOW)).toBe('lifetime')
  })

  it('reads an unexpired premium_until as an earned active month', () => {
    expect(resolveTier(profile({ premium_until: '2026-09-19T12:00:00Z' }), NOW)).toBe('earned_active')
  })

  it('reads a past premium_until as expired', () => {
    expect(resolveTier(profile({ premium_until: '2026-07-19T12:00:00Z' }), NOW)).toBe('earned_expired')
  })

  it('counts the exact expiry instant as expired, not active', () => {
    expect(resolveTier(profile({ premium_until: NOW.toISOString() }), NOW)).toBe('earned_expired')
  })

  it('falls back to free for no premium_until', () => {
    expect(resolveTier(profile(), NOW)).toBe('free')
  })

  it('falls back to free rather than throwing on an unparseable date', () => {
    expect(resolveTier(profile({ premium_until: 'not-a-date' }), NOW)).toBe('free')
  })
})

describe('buildPersonalHtml', () => {
  it('renders nothing at all for a free user', () => {
    expect(buildPersonalHtml(profile(), OPTS)).toBe('')
  })

  it('gives a lifetime member the VIP badge and a personal reply button', () => {
    const html = buildPersonalHtml(profile({ is_premium: true }), OPTS)
    expect(html).toContain('LIFETIME MEMBER')
    expect(html).toContain('mailto:hello@example.com')
    expect(html).toContain('Tell me what to build next')
  })

  it('shows a lifetime member their points without demoting them to contributor', () => {
    const html = buildPersonalHtml(profile({ is_premium: true, contribution_points: 15 }), OPTS)
    expect(html).toContain('LIFETIME MEMBER')
    expect(html).toContain('15 contribution points')
    expect(html).toContain('3 free months earned')
    expect(html).not.toContain('CONTRIBUTOR')
    expect(html).not.toContain('lifetime access &rarr;')   // no upsell to an existing customer
  })

  it('never offers the upgrade CTA to someone who already paid', () => {
    const html = buildPersonalHtml(profile({ is_premium: true, contribution_points: 5 }), OPTS)
    expect(html).not.toContain(OPTS.upgradeUrl)
  })

  it('tells an active earner when their free month runs out', () => {
    const p = profile({ premium_until: '2026-09-19T12:00:00Z', contribution_points: 5 })
    const html = buildPersonalHtml(p, OPTS)
    expect(html).toContain('19 September 2026')
    expect(html).toContain('31 days from today')
    expect(html).toContain('Pay once, keep it for life')
    expect(html).toContain(OPTS.upgradeUrl)
  })

  it('tells a lapsed earner when access ended and offers lifetime', () => {
    const p = profile({ premium_until: '2026-07-19T12:00:00Z', contribution_points: 5 })
    const html = buildPersonalHtml(p, OPTS)
    expect(html).toContain('19 July 2026')
    expect(html).toContain('Pay once, get lifetime access')
    expect(html).toContain(OPTS.upgradeUrl)
  })
})

describe('personalisation copy details', () => {
  it('falls back to the email local-part when no nickname is set', () => {
    const html = buildLifetimeHtml(profile({ nickname: null }), 'a@b.com')
    expect(html).toContain('rider,')
  })

  it('escapes a nickname instead of letting it inject markup', () => {
    const html = buildLifetimeHtml(profile({ nickname: '<script>alert(1)</script>' }), 'a@b.com')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('singularises a single point and a single earned month', () => {
    const html = buildEarnedExpiredHtml(profile({ premium_until: '2026-07-19T12:00:00Z', contribution_points: 1 }), 'u')
    expect(html).toContain('1 contribution point')
    expect(html).not.toContain('1 contribution points')
    expect(html).not.toContain('months earned')
  })

  it('omits the points line entirely at zero points', () => {
    const html = buildEarnedActiveHtml(profile({ premium_until: '2026-09-19T12:00:00Z' }), 'u', NOW)
    expect(html).not.toContain('contribution point')
  })

  it('does not report negative days once expiry has passed', () => {
    const html = buildEarnedActiveHtml(profile({ premium_until: '2026-07-19T12:00:00Z' }), 'u', NOW)
    expect(html).not.toMatch(/-\d+ days/)
  })
})

describe('buildYourSpotsHtml', () => {
  const fav = (spot_name: string, spot_label?: string) => ({ email: 'r@e.com', spot_name, spot_label })

  it('renders nothing when the rider has no favourites', () => {
    expect(buildYourSpotsHtml([], 'https://app.test/')).toBe('')
  })

  it('lists every favourite and counts them', () => {
    const html = buildYourSpotsHtml([fav('Riverwoods'), fav('Cadzand')], 'https://app.test/')
    expect(html).toContain('The 2 spots you watch')
    expect(html).toContain('Riverwoods')
    expect(html).toContain('Cadzand')
  })

  it('uses the singular phrasing for one spot', () => {
    const html = buildYourSpotsHtml([fav('Riverwoods')], 'https://app.test/')
    expect(html).toContain('The spot you watch')
  })

  it('prefers the label over the raw spot name', () => {
    const html = buildYourSpotsHtml([fav('nieuwpoort', 'Nieuwpoort')], 'https://app.test/')
    expect(html).toContain('Nieuwpoort')
  })

  it('escapes spot labels', () => {
    const html = buildYourSpotsHtml([fav('x', '<img src=x onerror=1>')], 'https://app.test/')
    expect(html).not.toContain('<img')
  })

  it('drops blank names rather than rendering empty chips', () => {
    expect(buildYourSpotsHtml([fav('   ')], 'https://app.test/')).toBe('')
  })
})
