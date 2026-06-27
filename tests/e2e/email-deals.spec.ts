import { test, expect } from '@playwright/test';
import { pickDeal, buildDealAdHTML, type Deal } from '../../supabase/functions/weekly-digest/deals';

const base: Deal = {
  id: '1', shop_name: 'Billy Kite', headline: 'Gear up', body: null, image_url: null,
  cta_label: 'Shop →', cta_url: 'https://billykite.be', active: true, weight: 1,
  starts_at: null, ends_at: null,
};
const NOW = Date.UTC(2026, 5, 27);

test('pickDeal returns null when there are no active in-range deals', () => {
  expect(pickDeal([], NOW)).toBeNull();
  expect(pickDeal([{ ...base, active: false }], NOW)).toBeNull();
  // out of date range
  expect(pickDeal([{ ...base, starts_at: '2026-07-01T00:00:00Z' }], NOW)).toBeNull();
  expect(pickDeal([{ ...base, ends_at: '2026-06-01T00:00:00Z' }], NOW)).toBeNull();
});

test('pickDeal returns the only active in-range deal', () => {
  const d = pickDeal([{ ...base, id: 'x' }], NOW);
  expect(d?.id).toBe('x');
});

test('pickDeal weights the pick (rng injected, deterministic)', () => {
  const light = { ...base, id: 'light', weight: 1 };
  const heavy = { ...base, id: 'heavy', weight: 3 };
  // total weight 4; cumulative [light:1, heavy:4]. rng=0.5 -> 0.5*4=2 -> falls in heavy.
  expect(pickDeal([light, heavy], NOW, () => 0.5)?.id).toBe('heavy');
  // rng=0.1 -> 0.4 -> falls in light (first bucket up to 1)
  expect(pickDeal([light, heavy], NOW, () => 0.1)?.id).toBe('light');
});

test('buildDealAdHTML returns empty string for null', () => {
  expect(buildDealAdHTML(null)).toBe('');
});

test('buildDealAdHTML renders shop, headline and the CTA url', () => {
  const html = buildDealAdHTML(base);
  expect(html).toContain('Billy Kite');
  expect(html).toContain('Gear up');
  expect(html).toContain('https://billykite.be');
});

test('buildDealAdHTML escapes HTML in fields', () => {
  const html = buildDealAdHTML({ ...base, headline: 'A & B <script>' });
  expect(html).toContain('A &amp; B &lt;script&gt;');
  expect(html).not.toContain('<script>');
});

test('buildDealAdHTML neutralises a non-http cta_url scheme', () => {
  const html = buildDealAdHTML({ ...base, cta_url: 'javascript:alert(1)' });
  expect(html).not.toContain('javascript:');
  expect(html).toContain('href="#"'); // falls back to a safe href
});

test('buildDealAdHTML keeps a normal https cta_url', () => {
  const html = buildDealAdHTML({ ...base, cta_url: 'https://billykite.be/sale' });
  expect(html).toContain('https://billykite.be/sale');
});
