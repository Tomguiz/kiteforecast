import { describe, it, expect } from 'vitest'
import { pickDeal, buildDealAdHTML, type Deal } from '../../supabase/functions/weekly-digest/deals.ts'

// Pure logic — no browser, no page. It lived in tests/e2e and imported the
// module without a .ts extension, which is the one import style nothing else
// in this repo uses: every other module-importing test is a vitest unit test.
// Playwright's ESM resolution choked on it in CI ("Named export
// 'buildDealAdHTML' not found ... is a CommonJS module"), while passing locally
// off a warm node_modules. Moved to where its siblings already are.

describe('email deals', () => {

  const base: Deal = {
  id: '1', shop_name: 'Billy Kite', headline: 'Gear up', body: null, image_url: null,
  cta_label: 'Shop →', cta_url: 'https://billykite.be', active: true, weight: 1,
  starts_at: null, ends_at: null,
  };
  const NOW = Date.UTC(2026, 5, 27);

  it('pickDeal returns null when there are no active in-range deals', () => {
  expect(pickDeal([], NOW)).toBeNull();
  expect(pickDeal([{ ...base, active: false }], NOW)).toBeNull();
  // out of date range
  expect(pickDeal([{ ...base, starts_at: '2026-07-01T00:00:00Z' }], NOW)).toBeNull();
  expect(pickDeal([{ ...base, ends_at: '2026-06-01T00:00:00Z' }], NOW)).toBeNull();
  });

  it('pickDeal returns the only active in-range deal', () => {
  const d = pickDeal([{ ...base, id: 'x' }], NOW);
  expect(d?.id).toBe('x');
  });

  it('pickDeal weights the pick (rng injected, deterministic)', () => {
  const light = { ...base, id: 'light', weight: 1 };
  const heavy = { ...base, id: 'heavy', weight: 3 };
  // total weight 4; cumulative [light:1, heavy:4]. rng=0.5 -> 0.5*4=2 -> falls in heavy.
  expect(pickDeal([light, heavy], NOW, () => 0.5)?.id).toBe('heavy');
  // rng=0.1 -> 0.4 -> falls in light (first bucket up to 1)
  expect(pickDeal([light, heavy], NOW, () => 0.1)?.id).toBe('light');
  });

  it('buildDealAdHTML returns empty string for null', () => {
  expect(buildDealAdHTML(null)).toBe('');
  });

  it('buildDealAdHTML renders shop, headline and the CTA url', () => {
  const html = buildDealAdHTML(base);
  expect(html).toContain('Billy Kite');
  expect(html).toContain('Gear up');
  expect(html).toContain('https://billykite.be');
  });

  it('buildDealAdHTML escapes HTML in fields', () => {
  const html = buildDealAdHTML({ ...base, headline: 'A & B <script>' });
  expect(html).toContain('A &amp; B &lt;script&gt;');
  expect(html).not.toContain('<script>');
  });

  it('buildDealAdHTML neutralises a non-http cta_url scheme', () => {
  const html = buildDealAdHTML({ ...base, cta_url: 'javascript:alert(1)' });
  expect(html).not.toContain('javascript:');
  expect(html).toContain('href="#"'); // falls back to a safe href
  });

  it('buildDealAdHTML keeps a normal https cta_url', () => {
  const html = buildDealAdHTML({ ...base, cta_url: 'https://billykite.be/sale' });
  expect(html).toContain('https://billykite.be/sale');
  });
})

// ── Billy Kite branding ────────────────────────────────────────────────────
//
// The slot used to wear KiteForecast's own palette (dark card, cyan headline),
// which made a paid ad look like more forecast. It now wears the sponsor's:
// #ff6600, sampled from billy.be, on a white card — the only light block in a
// dark email, so it reads as an ad rather than as editorial.
describe('deal ad branding', () => {
  const deal: Deal = {
    id: '1', shop_name: 'Billy Kite', headline: 'Gear up', body: 'Kites & boards',
    image_url: null, cta_label: 'Shop →', cta_url: 'https://billykite.be',
    active: true, weight: 1, starts_at: null, ends_at: null,
  }

  it("uses the sponsor's orange, not the app's cyan", () => {
    const html = buildDealAdHTML(deal)
    expect(html).toContain('#ff6600')
    expect(html).not.toContain('#5dd4f0')   // KiteForecast's accent
  })

  it('never puts white text on the orange', () => {
    // white on #ff6600 is 2.94:1 — it fails even the 3:1 large-text floor.
    // Black is 6.43:1. billy.be's own top bar uses white; that ratio is not
    // worth copying.
    const html = buildDealAdHTML(deal)
    const orangeBlocks = html.split('#ff6600').slice(1)
    for (const b of orangeBlocks) {
      const decl = b.slice(0, 300)
      expect(decl).not.toMatch(/color:\s*#fff/i)
      expect(decl).not.toMatch(/color:\s*white/i)
    }
  })

  it('renders the photo when there is one, and nothing when there is not', () => {
    const withImg = buildDealAdHTML({ ...deal, image_url: 'https://billy.be/cdn/shop/files/x.jpg?width=799' })
    expect(withImg).toContain('<img')
    expect(withImg).toContain('billy.be/cdn/shop/files/x.jpg')
    // the query string has to survive escaping intact, or the crop is lost
    expect(withImg).toContain('width=799')

    expect(buildDealAdHTML(deal)).not.toContain('<img')
  })

  it('refuses a non-http image just as it refuses a non-http cta', () => {
    const html = buildDealAdHTML({ ...deal, image_url: 'javascript:alert(1)' })
    expect(html).not.toContain('javascript:')
  })
})
