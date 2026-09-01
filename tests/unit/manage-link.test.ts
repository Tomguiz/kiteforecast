import { describe, it, expect } from 'vitest'
import { buildManageLink } from '../../supabase/functions/_shared/manage-link.ts'

describe('buildManageLink', () => {
  const APP_LINK = 'https://kiteforecast.app/?spot=Cadzand&date=2026-08-22'

  it('points at the notifications tab for the spot and day that triggered the mail', () => {
    expect(buildManageLink(APP_LINK, 'Cadzand', '2026-08-22'))
      .toBe('https://kiteforecast.app/?tab=notifs&spot=Cadzand&date=2026-08-22')
  })

  it('drops app_link’s own query rather than appending to it', () => {
    const url = buildManageLink(APP_LINK, 'Cadzand', '2026-08-22')
    expect(url.match(/\?/g)).toHaveLength(1)
    expect(url).not.toContain('date=2026-08-22&')
  })

  it('carries the date from the argument, not from app_link', () => {
    // check-new-sessions rewrites app_link's date per session; a stale one here
    // would highlight the wrong row.
    expect(buildManageLink(APP_LINK, 'Cadzand', '2026-09-01')).toContain('date=2026-09-01')
  })

  it('falls back to production for rows with no app_link', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(buildManageLink(empty, 'Cadzand', '2026-08-22'))
        .toBe('https://kiteforecast.app/?tab=notifs&spot=Cadzand&date=2026-08-22')
    }
  })

  it('preserves a non-production base, so a staging app_link stays on staging', () => {
    expect(buildManageLink('http://localhost:8080/index.html?spot=X', 'X', '2026-08-22'))
      .toBe('http://localhost:8080/index.html?tab=notifs&spot=X&date=2026-08-22')
  })

  it('encodes spot names that would otherwise break the query string', () => {
    const url = buildManageLink(APP_LINK, "Brouwersdam Zuid & Noord", '2026-08-22')
    expect(url).toContain('spot=Brouwersdam%20Zuid%20%26%20Noord')
    expect(url.match(/&/g)).toHaveLength(2)  // the two real separators only
  })

  it('encodes a spot name carrying a quote, which cannot break out of href', () => {
    expect(buildManageLink(APP_LINK, `O'Neill "spot"`, '2026-08-22'))
      .not.toMatch(/["']/)
  })
})
