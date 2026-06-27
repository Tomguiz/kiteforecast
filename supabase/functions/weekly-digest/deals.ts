export type Deal = {
  id: string; shop_name: string; headline: string;
  body?: string | null; image_url?: string | null;
  cta_label: string; cta_url: string;
  active: boolean; weight: number;
  starts_at?: string | null; ends_at?: string | null;
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

// Email-safe, table-based ad block matching the digest's dark theme. '' when no deal.
export function buildDealAdHTML(deal: Deal | null): string {
  if (!deal) return '';
  const img = deal.image_url
    ? `<tr><td style="padding:0 0 12px 0;"><img src="${safeUrl(deal.image_url)}" width="100%" alt="${esc(deal.shop_name)}" style="display:block;border-radius:8px;max-width:100%;"/></td></tr>`
    : '';
  const body = deal.body ? `<p style="margin:6px 0 0 0;font-size:13px;color:#94a3b8;line-height:1.5;">${esc(deal.body)}</p>` : '';
  return `
    <tr>
      <td style="background-color:#141b27;border-left:1px solid #1e2535;border-right:1px solid #1e2535;border-bottom:1px solid #1e2535;padding:20px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${img}
          <tr><td>
            <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4a5568;">Deal &middot; ${esc(deal.shop_name)}</p>
            <p style="margin:4px 0 0 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#5dd4f0;letter-spacing:.5px;">${esc(deal.headline)}</p>
            ${body}
          </td></tr>
          <tr><td style="padding-top:14px;">
            <a href="${safeUrl(deal.cta_url)}" style="display:inline-block;background:rgba(93,212,240,.12);border:1px solid rgba(93,212,240,.35);border-radius:8px;padding:10px 18px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;font-weight:700;color:#5dd4f0;text-decoration:none;">${esc(deal.cta_label)}</a>
          </td></tr>
        </table>
      </td>
    </tr>`;
}
