export type Deal = {
  id: string; shop_name: string; headline: string;
  body?: string | null; image_url?: string | null;
  cta_label: string; cta_url: string;
  active: boolean; weight: number;
  starts_at?: string | null; ends_at?: string | null;
  // Present on every row (email_deals.impressions is NOT NULL DEFAULT 0) and
  // read back by the digest to increment the counter, but the type never
  // declared it, so `deno check` failed on this branch before the rebase too.
  // Optional because pickDeal is also fed hand-built rows in the tests.
  impressions?: number;
};

function inRange(d: Deal, nowMs: number): boolean {
  if (d.starts_at && Date.parse(d.starts_at) > nowMs) return false;
  if (d.ends_at && Date.parse(d.ends_at) < nowMs) return false;
  return true;
}

// Pure, dependency-free so it is importable by both the Deno function and a Node test.
export function pickDeal(deals: Deal[], nowMs: number, rng: () => number = Math.random): Deal | null {
  const eligible = (deals || []).filter(d => d.active && inRange(d, nowMs));
  if (!eligible.length) return null;
  const weights = eligible.map(d => (d.weight && d.weight > 0 ? d.weight : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r < 0) return eligible[i];
  }
  return eligible[eligible.length - 1]; // float-rounding fallback
}

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only allow http(s) URLs in email hrefs/img-src; anything else (javascript:,
// data:, …) falls back to '#'. Then HTML-escape for safe attribute embedding.
function safeUrl(s: string | null | undefined): string {
  const u = String(s ?? '').trim();
  return esc(/^https?:\/\//i.test(u) ? u : '#');
}

// Email-safe, table-based ad block. '' when there is no deal to show.
// Billy Kite's own identity, not KiteForecast's: #ff6600 with a black
// wordmark bar and white body, taken from billy.be (the orange is theirs,
// sampled from the site — it appears 14 times on the home page).
//
// Deliberately the only light block in a dark email. A sponsor slot styled
// like the forecast around it reads as editorial content; this one is
// visibly an ad, which is fairer to the reader and better for the sponsor.
const BILLY_ORANGE = '#ff6600';

export function buildDealAdHTML(deal: Deal | null): string {
  if (!deal) return '';
  const img = deal.image_url
    ? `<tr><td style="padding:0;"><img src="${safeUrl(deal.image_url)}" width="100%" alt="${esc(deal.shop_name)}" style="display:block;width:100%;max-width:100%;border:0;"/></td></tr>`
    : '';
  const body = deal.body
    ? `<p style="margin:8px 0 0 0;font-family:Lato,Arial,sans-serif;font-size:14px;color:#3f3f46;line-height:1.55;">${esc(deal.body)}</p>`
    : '';
  // Black on the orange, never white: white on #ff6600 is 2.94:1, which fails
  // even the large-text floor. Black is 6.43:1. Their own top bar uses white,
  // but that is not a contrast ratio worth copying.
  return `
    <tr>
      <td style="background-color:${BILLY_ORANGE};padding:10px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-family:Lato,Arial,sans-serif;font-size:13px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;color:#111111;">${esc(deal.shop_name)}</td>
          <td align="right" style="font-family:Lato,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#111111;opacity:.72;">Sponsor</td>
        </tr></table>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${img}
          <tr><td style="padding:20px 32px 22px 32px;">
            <p style="margin:0;font-family:Lato,Arial,sans-serif;font-size:24px;font-weight:900;line-height:1.2;color:#111111;">${esc(deal.headline)}</p>
            ${body}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
              <td style="background-color:${BILLY_ORANGE};border-radius:4px;">
                <a href="${safeUrl(deal.cta_url)}" style="display:inline-block;padding:13px 26px;font-family:Lato,Arial,sans-serif;font-size:14px;font-weight:900;letter-spacing:.4px;color:#111111;text-decoration:none;">${esc(deal.cta_label)}</a>
              </td>
            </tr></table>
          </td></tr>
        </table>
      </td>
    </tr>`;
}
