import { describe, it, expect } from 'vitest'
import { renderLiveHtml, dirLabel, escHtml } from '../../supabase/functions/_shared/live-html.ts'
import type { LiveWind } from '../../supabase/functions/_shared/rws.ts'

const base: LiveWind = {
  stationId:  'CAWI',
  stationName: 'Cadzand wind',
  distanceKm: 5.42,
  speedKn:    22,
  dirDeg:     270,
  gustKn:     26,
  ageMin:     4,
  viewerUrl:  'https://example.test/cawi',
}

describe('renderLiveHtml — LIVE badge', () => {
  it('marks the block as live', () => {
    expect(renderLiveHtml(base)).toContain('&#9679; LIVE')
  })

  it('renders the badge as a filled pill legible against white text', () => {
    const html = renderLiveHtml(base)
    // #dc2626 on #ffffff is 4.8:1. The app's own live red (#ff6b6b) is ~2.9:1
    // and must not creep back in as a fill — see the note in live-html.ts.
    expect(html).toContain('background-color:#dc2626')
    expect(html).toContain('color:#ffffff')
    expect(html).not.toContain('background-color:#ff6b6b')
  })

  it('keeps the badge ahead of the existing neutral label, which is unchanged', () => {
    const html = renderLiveHtml(base)
    expect(html.indexOf('LIVE')).toBeLessThan(html.indexOf('Current reading at the nearest mast'))
  })

  it('states no verdict, so the same block serves the SESSION OFF email', () => {
    const dead = renderLiveHtml({ ...base, speedKn: 3, gustKn: null, dirDeg: null })
    expect(dead).toContain('&#9679; LIVE')
    expect(dead).toContain('3 kn')
    expect(dead).not.toMatch(/good|firing|going off/i)
  })
})

describe('renderLiveHtml — reading', () => {
  it('renders speed, direction and gusts', () => {
    expect(renderLiveHtml(base)).toContain('22 kn W &middot; gusts 26 kn')
  })

  it('omits gusts when the gust feed had no entry for the station', () => {
    const html = renderLiveHtml({ ...base, gustKn: null })
    expect(html).toContain('22 kn W')
    expect(html).not.toContain('gusts')
  })

  it('omits direction when the direction feed had no entry', () => {
    expect(renderLiveHtml({ ...base, dirDeg: null })).toContain('>22 kn &middot; gusts 26 kn<')
  })

  it('says "just now" at or under a minute old', () => {
    expect(renderLiveHtml({ ...base, ageMin: 1 })).toContain('just now')
    expect(renderLiveHtml({ ...base, ageMin: 2 })).toContain('2 min ago')
  })

  it('rounds distance to one decimal', () => {
    expect(renderLiveHtml(base)).toContain('5.4 km away')
  })

  it('escapes the station name, the one untrusted value in the block', () => {
    const html = renderLiveHtml({ ...base, stationName: '<img src=x onerror=alert(1)>' })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('dirLabel', () => {
  it('maps degrees onto the 8-point compass', () => {
    expect(dirLabel(0)).toBe('N')
    expect(dirLabel(270)).toBe('W')
    expect(dirLabel(350)).toBe('N')
  })
  it('normalises out-of-range degrees', () => {
    expect(dirLabel(-90)).toBe('W')
    expect(dirLabel(450)).toBe('E')
  })
  it('returns empty for a missing direction', () => {
    expect(dirLabel(null)).toBe('')
  })
})

describe('escHtml', () => {
  it('escapes every character that can break out of an attribute or tag', () => {
    expect(escHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })
  it('escapes ampersands before the entities it introduces', () => {
    expect(escHtml('&lt;')).toBe('&amp;lt;')
  })
})
