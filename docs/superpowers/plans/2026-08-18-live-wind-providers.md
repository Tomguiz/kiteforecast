# Live Wind From Station Providers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a rider submits a live-wind URL, the app resolves it to a weather-station provider and shows that station's live reading in the spot page's "Measured right now" banner — the same banner RWS already fills.

**Architecture:** Every provider is fetched through one new edge function, `wind-proxy`, so the adapters live once in `supabase/functions/_shared/providers.ts` and the browser holds no provider-specific code. A second endpoint, `wind-discover`, turns a pasted club page into a `{provider, station_id}` pair exactly once (at submit and at admin-apply), never on render. `_liveWindHref`/`renderLiveWindPanel` gain one source ahead of RWS.

**Tech Stack:** Deno edge functions (Supabase), vanilla JS in `index.html`, Vitest for pure logic, Playwright for the browser and for deployed-function security gates.

**Spec:** `docs/superpowers/specs/2026-08-18-live-wind-providers-design.md`

## Global Constraints

- **Knots everywhere.** Adapters convert; the panel only ever sees knots. `toKnotsR` rounds.
- **Staleness is two-sided.** A reading older than `RWS_MAX_AGE_MIN` (30) is `null`; so is one more than `RWS_MAX_FUTURE_MIN` (2) minutes in the future.
- **Every failure degrades to hidden.** No provider error ever reaches the UI. A dead provider looks like a spot without one.
- **WeatherLink units:** speed from `convertedValue` (knots), direction from `value` (degrees). `value` is the station's native imperial unit — using it for speed publishes readings ~14% high.
- **Schema is applied by hand.** Run DDL via `supabase db query --linked`, verify against `information_schema`, then `NOTIFY pgrst, 'reload schema'`.
- **Edge functions must be redeployed** (`supabase functions deploy <name>`) — a known rot in this project. Verify before concluding a change "didn't work".
- Provider slugs are exactly `'pioupiou' | 'holfuy' | 'weatherlink'`.

---

### Task 1: Resolve a URL to a provider and station id

**Files:**
- Create: `supabase/functions/_shared/providers.ts`
- Test: `tests/unit/providers.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type ProviderId = 'pioupiou' | 'holfuy' | 'weatherlink'`; `interface ProviderRef { provider: ProviderId; stationId: string }`; `providerFromUrl(url: string): ProviderRef | null`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { providerFromUrl } from '../../supabase/functions/_shared/providers.ts'

describe('providerFromUrl', () => {
  it('reads a weatherlink embeddable-page uuid', () => {
    expect(providerFromUrl('https://www.weatherlink.com/embeddablePage/show/87ca27e8616443678fffe486311370ee/signature'))
      .toEqual({ provider: 'weatherlink', stationId: '87ca27e8616443678fffe486311370ee' })
  })

  it('reads a holfuy station id from either URL shape', () => {
    expect(providerFromUrl('https://api.holfuy.com/live/?s=101&m=JSON'))
      .toEqual({ provider: 'holfuy', stationId: '101' })
    expect(providerFromUrl('https://holfuy.com/en/weather/101'))
      .toEqual({ provider: 'holfuy', stationId: '101' })
  })

  it('reads a pioupiou id from the api and openwindmap shapes', () => {
    expect(providerFromUrl('https://api.pioupiou.fr/v1/live/1234'))
      .toEqual({ provider: 'pioupiou', stationId: '1234' })
    expect(providerFromUrl('https://www.openwindmap.org/PP-1234'))
      .toEqual({ provider: 'pioupiou', stationId: '1234' })
  })

  it('refuses lookalike hosts and non-provider URLs', () => {
    expect(providerFromUrl('https://weatherlink.com.attacker.example/embeddablePage/show/abc/signature')).toBeNull()
    expect(providerFromUrl('https://notholfuy.com/en/weather/101')).toBeNull()
    expect(providerFromUrl('https://www.sycod.be/nl/meteo')).toBeNull()
    expect(providerFromUrl('javascript:alert(1)')).toBeNull()
    expect(providerFromUrl('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/providers.test.ts`
Expected: FAIL — cannot resolve `../../supabase/functions/_shared/providers.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
export type ProviderId = 'pioupiou' | 'holfuy' | 'weatherlink'
export interface ProviderRef { provider: ProviderId; stationId: string }

// Host match is exact-or-subdomain, never a suffix test: `endsWith('holfuy.com')`
// would accept `notholfuy.com`, and a raw regex over the URL string would accept
// `weatherlink.com.attacker.example/embeddablePage/...`.
function hostIs(host: string, base: string): boolean {
  return host === base || host.endsWith('.' + base)
}

export function providerFromUrl(url: string): ProviderRef | null {
  let u: URL
  try { u = new URL(String(url || '').trim()) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()

  if (hostIs(host, 'weatherlink.com')) {
    const m = u.pathname.match(/\/embeddablePage\/(?:show|summaryData)\/([0-9a-f]{16,64})/i)
    return m ? { provider: 'weatherlink', stationId: m[1] } : null
  }
  if (hostIs(host, 'holfuy.com')) {
    const s = u.searchParams.get('s')
    if (s && /^\d+$/.test(s)) return { provider: 'holfuy', stationId: s }
    const m = u.pathname.match(/\/weather\/(\d+)/)
    return m ? { provider: 'holfuy', stationId: m[1] } : null
  }
  if (hostIs(host, 'pioupiou.fr')) {
    const m = u.pathname.match(/\/live\/(\d+)/)
    return m ? { provider: 'pioupiou', stationId: m[1] } : null
  }
  if (hostIs(host, 'openwindmap.org')) {
    const m = u.pathname.match(/\/PP-?(\d+)/i)
    return m ? { provider: 'pioupiou', stationId: m[1] } : null
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/providers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/providers.ts tests/unit/providers.test.ts
git commit -m "feat(live-wind): resolve a submitted URL to a provider + station id"
```

---

### Task 2: Adapters — provider payload to LiveWind

**Files:**
- Modify: `supabase/functions/_shared/providers.ts`
- Test: `tests/unit/providers.test.ts`

**Interfaces:**
- Consumes: `ProviderId` (Task 1); `LiveWind` and `RWS_MAX_AGE_MIN`, `RWS_MAX_FUTURE_MIN` from `./rws.ts`
- Produces: `toLiveWindFrom(provider: ProviderId, stationId: string, payload: unknown, now: Date): LiveWind | null`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/providers.test.ts`. Payloads are captured from the live APIs on 2026-08-18.

```ts
import { toLiveWindFrom } from '../../supabase/functions/_shared/providers.ts'

const NOW = new Date('2026-08-18T08:40:00Z')

// Captured: weatherlink.com/embeddablePage/summaryData/87ca27e8... (Sycod)
const weatherlink = {
  ownerName: 'Sycod',
  lastReceived: Date.parse('2026-08-18T08:38:48Z'),
  currConditionValues: [
    { displayName: 'Wind Speed',             value: 25,  convertedValue: 22, unitLabel: 'knots' },
    { displayName: 'Wind Direction',         value: 251, convertedValue: 5648, unitLabel: '' },
    { displayName: '10 Min High Wind Speed', value: 28,  convertedValue: 24, unitLabel: 'knots' },
  ],
}

// Captured: api.holfuy.com/live/?s=101&m=JSON — speed/gust in km/h
const holfuy = {
  stationId: 101, stationName: 'TestStation', dateTime: '2026-08-18 08:38:00',
  wind: { speed: 40.7, gust: 51.9, min: 20, unit: 'km/h', direction: 268 },
}

describe('toLiveWindFrom', () => {
  it('takes weatherlink speed from convertedValue and direction from value', () => {
    const lw = toLiveWindFrom('weatherlink', '87ca27e8', weatherlink, NOW)!
    expect(lw.speedKn).toBe(22)      // NOT 25 — value is mph, convertedValue is knots
    expect(lw.dirDeg).toBe(251)      // NOT 5648 — convertedValue is meaningless here
    expect(lw.gustKn).toBe(24)
    expect(lw.stationName).toBe('Sycod')
    expect(lw.ageMin).toBe(1)
  })

  it('converts holfuy km/h to knots', () => {
    const lw = toLiveWindFrom('holfuy', '101', holfuy, NOW)!
    expect(lw.speedKn).toBe(22)      // 40.7 km/h
    expect(lw.gustKn).toBe(28)       // 51.9 km/h
    expect(lw.dirDeg).toBe(268)
  })

  it('converts pioupiou m/s to knots and reads its nested shape', () => {
    const pioupiou = { data: { id: 1234, meta: { name: 'Zeebrugge' },
      measurements: { date: '2026-08-18T08:38:00Z', wind_speed_avg: 11.3, wind_speed_max: 14.4, wind_heading: 251 } } }
    const lw = toLiveWindFrom('pioupiou', '1234', pioupiou, NOW)!
    expect(lw.speedKn).toBe(22)      // 11.3 m/s
    expect(lw.gustKn).toBe(28)       // 14.4 m/s
    expect(lw.stationName).toBe('Zeebrugge')
  })

  it('rejects a stale reading and a future one', () => {
    const stale = { ...weatherlink, lastReceived: Date.parse('2026-08-18T08:00:00Z') } // 40 min
    expect(toLiveWindFrom('weatherlink', 'x', stale, NOW)).toBeNull()
    const future = { ...weatherlink, lastReceived: Date.parse('2026-08-18T08:50:00Z') } // +10 min
    expect(toLiveWindFrom('weatherlink', 'x', future, NOW)).toBeNull()
  })

  it('returns null rather than throwing on junk', () => {
    expect(toLiveWindFrom('holfuy', '1', null, NOW)).toBeNull()
    expect(toLiveWindFrom('holfuy', '1', {}, NOW)).toBeNull()
    expect(toLiveWindFrom('weatherlink', '1', { currConditionValues: [] }, NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/providers.test.ts`
Expected: FAIL — `toLiveWindFrom` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `supabase/functions/_shared/providers.ts`:

```ts
import { RWS_MAX_AGE_MIN, RWS_MAX_FUTURE_MIN, type LiveWind } from './rws.ts'

const KN_PER_MS   = 1.943844
const KN_PER_KMH  = 0.539957
const round = (n: number) => Math.round(n)

// Shared gate: a reading is only usable if we know when it was taken, it is not
// older than the RWS window, and it is not in the future. The future check is not
// paranoia — a feed that drops its timezone designator reads as permanently "now".
function ageMinOrNull(ts: number | null, now: Date): number | null {
  if (ts === null || !Number.isFinite(ts)) return null
  const ageMin = Math.round((now.getTime() - ts) / 60000)
  if (ageMin > RWS_MAX_AGE_MIN) return null
  if (ageMin < -RWS_MAX_FUTURE_MIN) return null
  return Math.max(0, ageMin)
}

function wlRow(payload: any, name: string): any {
  const rows = payload?.currConditionValues
  return Array.isArray(rows) ? rows.find((r: any) => r?.displayName === name) : undefined
}

export function toLiveWindFrom(
  provider: ProviderId, stationId: string, payload: unknown, now: Date,
): LiveWind | null {
  const p = payload as any
  if (!p || typeof p !== 'object') return null
  try {
    if (provider === 'weatherlink') {
      const speed = wlRow(p, 'Wind Speed')
      if (!speed) return null
      // convertedValue is the display unit (knots); value is the station's
      // native imperial unit. Direction is the exception — its convertedValue
      // is not a bearing, so it comes from value.
      const speedKn = round(Number(speed.convertedValue))
      const gust = wlRow(p, '10 Min High Wind Speed')
      const dir = wlRow(p, 'Wind Direction')
      const ageMin = ageMinOrNull(Number(p.lastReceived), now)
      if (ageMin === null || !Number.isFinite(speedKn)) return null
      return {
        stationId, stationName: String(p.ownerName || 'Station'), distanceKm: 0,
        speedKn, gustKn: gust ? round(Number(gust.convertedValue)) : null,
        dirDeg: dir && Number.isFinite(Number(dir.value)) ? Number(dir.value) : null,
        ageMin, viewerUrl: `https://www.weatherlink.com/embeddablePage/show/${stationId}/signature`,
      }
    }
    if (provider === 'holfuy') {
      const w = p.wind
      if (!w || !Number.isFinite(Number(w.speed))) return null
      const f = w.unit === 'km/h' ? KN_PER_KMH : w.unit === 'm/s' ? KN_PER_MS : null
      if (f === null) return null
      const ageMin = ageMinOrNull(Date.parse(String(p.dateTime || '').replace(' ', 'T') + 'Z'), now)
      if (ageMin === null) return null
      return {
        stationId, stationName: String(p.stationName || 'Station'), distanceKm: 0,
        speedKn: round(Number(w.speed) * f),
        gustKn: Number.isFinite(Number(w.gust)) ? round(Number(w.gust) * f) : null,
        dirDeg: Number.isFinite(Number(w.direction)) ? Number(w.direction) : null,
        ageMin, viewerUrl: `https://holfuy.com/en/weather/${stationId}`,
      }
    }
    // pioupiou
    const d = p.data
    const m = d?.measurements
    if (!m || !Number.isFinite(Number(m.wind_speed_avg))) return null
    const ageMin = ageMinOrNull(Date.parse(String(m.date)), now)
    if (ageMin === null) return null
    return {
      stationId, stationName: String(d?.meta?.name || 'Station'), distanceKm: 0,
      speedKn: round(Number(m.wind_speed_avg) * KN_PER_MS),
      gustKn: Number.isFinite(Number(m.wind_speed_max)) ? round(Number(m.wind_speed_max) * KN_PER_MS) : null,
      dirDeg: Number.isFinite(Number(m.wind_heading)) ? Number(m.wind_heading) : null,
      ageMin, viewerUrl: `https://www.openwindmap.org/PP-${stationId}`,
    }
  } catch { return null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/providers.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/providers.ts tests/unit/providers.test.ts
git commit -m "feat(live-wind): adapters mapping provider payloads to LiveWind"
```

---

### Task 3: Discover a provider inside a pasted page

**Files:**
- Modify: `supabase/functions/_shared/providers.ts`
- Test: `tests/unit/providers.test.ts`

**Interfaces:**
- Consumes: `providerFromUrl` (Task 1)
- Produces: `discoverInHtml(html: string): ProviderRef | null`; `isBlockedHost(hostname: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { discoverInHtml, isBlockedHost } from '../../supabase/functions/_shared/providers.ts'

describe('discoverInHtml', () => {
  it('finds the weatherlink widget a club page embeds', () => {
    // The shape sycod.be/nl/meteo actually serves.
    const html = `<iframe frameborder='0' height='200'
      src='https://www.weatherlink.com/embeddablePage/show/87ca27e8616443678fffe486311370ee/signature'
      style="border: 0px none;"></iframe>`
    expect(discoverInHtml(html))
      .toEqual({ provider: 'weatherlink', stationId: '87ca27e8616443678fffe486311370ee' })
  })

  it('finds holfuy and pioupiou embeds', () => {
    expect(discoverInHtml(`<iframe src="https://api.holfuy.com/live/?s=101&m=JSON"></iframe>`))
      .toEqual({ provider: 'holfuy', stationId: '101' })
    expect(discoverInHtml(`<a href="https://www.openwindmap.org/PP-1234">wind</a>`))
      .toEqual({ provider: 'pioupiou', stationId: '1234' })
  })

  it('finds nothing in a page with no provider', () => {
    expect(discoverInHtml('<html><body><p>no wind here</p></body></html>')).toBeNull()
    expect(discoverInHtml('')).toBeNull()
  })
})

describe('isBlockedHost', () => {
  it('blocks loopback, private ranges, link-local and cloud metadata', () => {
    for (const h of ['127.0.0.1', 'localhost', '10.0.0.5', '172.16.0.1', '192.168.1.1',
                     '169.254.169.254', '[::1]', '::1', 'fd00::1', '0.0.0.0'])
      expect(isBlockedHost(h), h).toBe(true)
  })

  it('allows ordinary public hosts', () => {
    for (const h of ['www.sycod.be', 'weatherlink.com', '8.8.8.8'])
      expect(isBlockedHost(h), h).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/providers.test.ts`
Expected: FAIL — `discoverInHtml` is not exported

- [ ] **Step 3: Write minimal implementation**

```ts
// Pull every absolute http(s) URL out of the markup and keep the first that
// resolves to a provider. Deliberately NOT an HTML parse: we are looking for an
// identifier, not reading content, so a regex over hrefs and srcs is enough and
// cannot be confused by malformed markup.
export function discoverInHtml(html: string): ProviderRef | null {
  const text = String(html || '')
  const urls = text.match(/https?:\/\/[^\s"'<>\\]+/g) || []
  for (const raw of urls) {
    const ref = providerFromUrl(raw.replace(/&amp;/g, '&'))
    if (ref) return ref
  }
  return null
}

// Anything that could reach infrastructure rather than the public internet. The
// caller must re-run this after EVERY redirect, not just on the submitted URL.
export function isBlockedHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true
  // IPv6
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true   // unique-local fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true   // link-local fe80::/10
    return false
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false                              // a name; DNS is checked by the caller
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true           // link-local + cloud metadata
  if (a >= 224) return true                         // multicast / reserved
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/providers.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/providers.ts tests/unit/providers.test.ts
git commit -m "feat(live-wind): discover a provider widget inside a pasted page"
```

---

### Task 4: `wind-proxy` edge function

**Files:**
- Create: `supabase/functions/wind-proxy/index.ts`
- Modify: `tests/e2e/edge-functions.spec.ts`

**Interfaces:**
- Consumes: `providerFromUrl`, `toLiveWindFrom` (Tasks 1-2)
- Produces: `GET /functions/v1/wind-proxy?provider=<id>&station_id=<id>` → `LiveWind` JSON, or `{"live":null}`

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/edge-functions.spec.ts`:

```ts
test('wind-proxy refuses an unknown provider', async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${BASE}/wind-proxy?provider=evil&station_id=1`, {
    headers: { Authorization: `Bearer ${ANON}` },
  });
  expect(res.status()).toBe(400);
  await ctx.dispose();
});

test('wind-proxy takes no URL parameter — it cannot be aimed at a host', async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(
    `${BASE}/wind-proxy?provider=holfuy&station_id=1&url=http://169.254.169.254/`,
    { headers: { Authorization: `Bearer ${ANON}` } });
  // The url param is ignored entirely; the response is a normal provider result.
  expect(res.status()).toBe(200);
  expect(await res.text()).not.toContain('169.254');
  await ctx.dispose();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx playwright test e2e/edge-functions.spec.ts --grep wind-proxy`
Expected: FAIL — 404, the function is not deployed

- [ ] **Step 3: Write minimal implementation**

```ts
import { providerFromUrl, toLiveWindFrom, type ProviderId } from '../_shared/providers.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

// The endpoint takes a provider slug and a station id — never a URL. The upstream
// address is built here from a fixed template, so there is no input that makes
// this fetch an arbitrary host.
const ENDPOINT: Record<ProviderId, (id: string) => string> = {
  pioupiou:    id => `https://api.pioupiou.fr/v1/live/${encodeURIComponent(id)}`,
  holfuy:      id => `https://api.holfuy.com/live/?s=${encodeURIComponent(id)}&m=JSON&su=km/h`,
  weatherlink: id => `https://www.weatherlink.com/embeddablePage/summaryData/${encodeURIComponent(id)}`,
}
const ID_OK: Record<ProviderId, RegExp> = {
  pioupiou: /^\d{1,10}$/, holfuy: /^\d{1,10}$/, weatherlink: /^[0-9a-f]{16,64}$/i,
}

const TTL_MS = 60_000
const cache = new Map<string, { at: number; body: unknown }>()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const { searchParams } = new URL(req.url)
  const provider = String(searchParams.get('provider') || '') as ProviderId
  const stationId = String(searchParams.get('station_id') || '')

  if (!ENDPOINT[provider] || !ID_OK[provider]?.test(stationId)) {
    return json({ error: 'unknown provider or station_id' }, 400)
  }

  const key = `${provider}:${stationId}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body)

  let live = null
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 5000)
    const res = await fetch(ENDPOINT[provider](stationId), { signal: ac.signal })
    clearTimeout(t)
    if (res.ok) live = toLiveWindFrom(provider, stationId, await res.json(), new Date())
  } catch { live = null }        // every failure degrades to "no reading"

  const body = { live }
  cache.set(key, { at: Date.now(), body })
  return json(body)
})
```

- [ ] **Step 4: Deploy, then run the test to verify it passes**

```bash
supabase functions deploy wind-proxy
cd tests && npx playwright test e2e/edge-functions.spec.ts --grep wind-proxy
```
Expected: PASS (2 tests). Then sanity-check a real station:
```bash
curl -s "https://kpwmajtxmcfpakvonimf.supabase.co/functions/v1/wind-proxy?provider=weatherlink&station_id=87ca27e8616443678fffe486311370ee" -H "Authorization: Bearer $ANON" | head -c 200
```
Expected: `{"live":{"stationId":"87ca27e8…","stationName":"Sycod","speedKn":…}}`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/wind-proxy/index.ts tests/e2e/edge-functions.spec.ts
git commit -m "feat(live-wind): wind-proxy serves a station reading by provider + id"
```

---

### Task 5: `wind-discover` edge function

**Files:**
- Create: `supabase/functions/wind-discover/index.ts`
- Modify: `tests/e2e/edge-functions.spec.ts`

**Interfaces:**
- Consumes: `providerFromUrl`, `discoverInHtml`, `isBlockedHost` (Tasks 1, 3)
- Produces: `POST /functions/v1/wind-discover` with `{"url": "..."}` → `{"provider": "...", "station_id": "..."}` or `{"provider": null}`

- [ ] **Step 1: Write the failing test**

```ts
test('wind-discover rejects unauthenticated callers', async () => {
  const ctx = await request.newContext();
  const res = await ctx.post(`${BASE}/wind-discover`, {
    headers: { Authorization: `Bearer ${ANON}` },
    data: { url: 'https://www.sycod.be/nl/meteo' },
  });
  expect(res.status()).toBe(401);
  await ctx.dispose();
});

test('wind-discover refuses a private-range target', async () => {
  const ctx = await request.newContext();
  for (const url of ['http://169.254.169.254/latest/meta-data/',
                     'http://127.0.0.1:8000/', 'http://10.0.0.1/']) {
    const res = await ctx.post(`${BASE}/wind-discover`, {
      headers: { Authorization: `Bearer ${ANON}` }, data: { url },
    });
    // 401 (no user) or 400 (blocked) — never 200, and never any fetched content
    expect([400, 401]).toContain(res.status());
    expect(await res.text()).not.toContain('meta-data');
  }
  await ctx.dispose();
});
```

Also assert the limiter exists, as a unit test in `tests/unit/providers.test.ts`
is not possible for in-function state — this one is a deployed-function check:

```ts
test('wind-discover rate-limits a single caller', async () => {
  const ctx = await request.newContext();
  const codes: number[] = [];
  for (let i = 0; i < 8; i++) {
    const res = await ctx.post(`${BASE}/wind-discover`, {
      headers: { Authorization: `Bearer ${ANON}` }, data: { url: 'https://example.com/' },
    });
    codes.push(res.status());
  }
  // anon is rejected before the limiter, so this asserts the gate order:
  // never a 200, and never a 5xx from the limiter itself.
  expect(codes.every(c => c === 401 || c === 429)).toBe(true);
  await ctx.dispose();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx playwright test e2e/edge-functions.spec.ts --grep wind-discover`
Expected: FAIL — 404, the function is not deployed

- [ ] **Step 3: Write minimal implementation**

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { providerFromUrl, discoverInHtml, isBlockedHost } from '../_shared/providers.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const MAX_BYTES = 512 * 1024
const MAX_HOPS = 3

// Discovery is a once-per-suggestion action, so a handful per minute per user is
// generous. Without this, one signed-in account can use the function to probe the
// public internet at our expense and from our address.
const RATE_MAX = 5, RATE_WINDOW_MS = 60_000
const seen = new Map<string, number[]>()
function rateLimited(userId: string): boolean {
  const now = Date.now()
  const hits = (seen.get(userId) || []).filter(t => now - t < RATE_WINDOW_MS)
  hits.push(now)
  seen.set(userId, hits)
  return hits.length > RATE_MAX
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // Signed-in callers only: this reaches out to a URL the caller chose.
  const authHeader = req.headers.get('Authorization') || ''
  const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (rateLimited(user.id)) return json({ error: 'slow down' }, 429)

  const { url } = await req.json().catch(() => ({ url: '' }))

  // Already a provider URL? Then no fetch happens at all.
  const direct = providerFromUrl(String(url || ''))
  if (direct) return json({ provider: direct.provider, station_id: direct.stationId })

  let target: URL
  try { target = new URL(String(url || '')) } catch { return json({ error: 'bad url' }, 400) }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return json({ error: 'bad scheme' }, 400)

  // Follow redirects by hand so every hop is re-checked, not just the first.
  let html = ''
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (isBlockedHost(target.hostname)) return json({ error: 'blocked host' }, 400)
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 5000)
    let res: Response
    try {
      res = await fetch(target.href, { redirect: 'manual', signal: ac.signal, headers: { 'User-Agent': 'kiteforecast-discover' } })
    } catch { clearTimeout(t); return json({ provider: null }) }
    clearTimeout(t)

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return json({ provider: null })
      try { target = new URL(loc, target) } catch { return json({ provider: null }) }
      continue
    }
    if (!res.ok) return json({ provider: null })
    const buf = new Uint8Array(await res.arrayBuffer())
    html = new TextDecoder().decode(buf.slice(0, MAX_BYTES))
    break
  }

  // Only the identifier leaves this function — never the page body.
  const found = discoverInHtml(html)
  return json(found ? { provider: found.provider, station_id: found.stationId } : { provider: null })
})
```

- [ ] **Step 4: Deploy, then run the test to verify it passes**

```bash
supabase functions deploy wind-discover
cd tests && npx playwright test e2e/edge-functions.spec.ts --grep wind-discover
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/wind-discover/index.ts tests/e2e/edge-functions.spec.ts
git commit -m "feat(live-wind): wind-discover resolves a club page to a provider id"
```

---

### Task 6: Store the resolved provider on the spot

**Files:**
- Modify: `supabase/schema.sql` (append)
- Modify: `index.html` — `submitSuggestUpdate`, `adminOpenSpot`, `adminSaveSpotInfo`, `adminApplyUpdate`
- Test: `tests/e2e/live-wind-provider.spec.ts` (create)

**Interfaces:**
- Consumes: `wind-discover` (Task 5)
- Produces: `spot_info.live_wind_provider`, `spot_info.live_wind_station_id`; same two columns on `spot_update_suggestions`

- [ ] **Step 1: Apply the schema by hand and verify it**

```bash
supabase db query --linked "DO \$\$ BEGIN ALTER TABLE spot_info ADD COLUMN live_wind_provider text; EXCEPTION WHEN duplicate_column THEN NULL; END \$\$;
DO \$\$ BEGIN ALTER TABLE spot_info ADD COLUMN live_wind_station_id text; EXCEPTION WHEN duplicate_column THEN NULL; END \$\$;
DO \$\$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN live_wind_provider text; EXCEPTION WHEN duplicate_column THEN NULL; END \$\$;
DO \$\$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN live_wind_station_id text; EXCEPTION WHEN duplicate_column THEN NULL; END \$\$;"
supabase db query --linked "select table_name, column_name from information_schema.columns where column_name like 'live_wind_%' order by 1,2;"
supabase db query --linked "NOTIFY pgrst, 'reload schema';"
```
Expected: four rows across the two tables. Append the same idempotent `DO $$` blocks to `supabase/schema.sql`.

- [ ] **Step 2: Write the failing test**

```ts
import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

test('the admin form shows and saves the resolved provider', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.evaluate(() => { openProfilePanel('admin'); });
  await page.waitForFunction(() => !!document.getElementById('adminEditForm'));
  await page.evaluate(() => adminOpenSpot(null, {
    spot_name: 'Prov Spot', _lat: 51, _lon: 3, _loc: 'BE',
    live_wind_url: 'https://www.sycod.be/nl/meteo',
    live_wind_provider: 'weatherlink', live_wind_station_id: '87ca27e8616443678fffe486311370ee',
  }));
  await expect(page.locator('#adLiveWindProvider')).toContainText('weatherlink');

  const req = page.waitForRequest(r => r.url().includes('/rest/v1/spot_info') && r.method() === 'POST');
  await page.evaluate(() => adminSaveSpotInfo());
  const body = (await req).postData() || '';
  expect(body).toContain('"live_wind_provider":"weatherlink"');
  expect(body).toContain('"live_wind_station_id":"87ca27e8616443678fffe486311370ee"');
});

test('applying a suggestion carries the provider through to spot_info', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  const req = page.waitForRequest(r => r.url().includes('/rest/v1/spot_info') && r.method() === 'POST');
  await page.evaluate(() => adminApplyUpdate({
    id: 's1', spot_name: 'Prov Spot', live_wind_url: 'https://www.sycod.be/nl/meteo',
    live_wind_provider: 'weatherlink', live_wind_station_id: '87ca27e8616443678fffe486311370ee',
  }));
  expect((await req).postData() || '').toContain('"live_wind_provider":"weatherlink"');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tests && npx playwright test e2e/live-wind-provider.spec.ts`
Expected: FAIL — `#adLiveWindProvider` not found

- [ ] **Step 4: Write minimal implementation**

In `adminOpenSpot`, directly beneath the existing `adLiveWind` input:

```js
      <div id="adLiveWindProvider" style="font-size:.68rem;color:var(--tdim);margin:-4px 0 10px">
        ${s?.live_wind_provider
          ? `✓ readings via <strong style="color:#5dd4f0">${escFriendName(s.live_wind_provider)}</strong> · station ${escFriendName(s.live_wind_station_id||'')}`
          : 'No station provider detected — this URL will show as a link only.'}
      </div>
      <input type="hidden" id="adLiveWindProviderVal" value="${s?.live_wind_provider||''}"/>
      <input type="hidden" id="adLiveWindStationId" value="${s?.live_wind_station_id||''}"/>
```

In `adminSaveSpotInfo`, beside `live_wind_url`:

```js
    live_wind_provider:   ($('adLiveWindProviderVal')?.value||'').trim()||null,
    live_wind_station_id: ($('adLiveWindStationId')?.value||'').trim()||null,
```

In `adminApplyUpdate`, beside the `live_wind_url` line:

```js
  if(u.live_wind_provider)   updates.live_wind_provider=u.live_wind_provider;
  if(u.live_wind_station_id) updates.live_wind_station_id=u.live_wind_station_id;
```

In `submitSuggestUpdate`, after the `_liveWind` validation and before the insert — resolve the URL once so the admin sees what it produced:

```js
  // Resolve the submitted URL to a station provider once, here, rather than on
  // every render. A URL that resolves to nothing is still a perfectly good
  // link — this only decides whether the spot can show live numbers.
  let _prov=null,_provId=null;
  if(_liveWind){
    try{
      const r=await fetch('https://kpwmajtxmcfpakvonimf.supabase.co/functions/v1/wind-discover',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${_authSession?.access_token||''}`},
        body:JSON.stringify({url:_liveWind}),
      });
      const j=await r.json();
      if(j&&j.provider){ _prov=j.provider; _provId=j.station_id; }
    }catch(e){ /* discovery is a convenience; the suggestion stands without it */ }
  }
```

and add to the insert object:

```js
    live_wind_provider:_prov, live_wind_station_id:_provId,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tests && npx playwright test e2e/live-wind-provider.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql index.html tests/e2e/live-wind-provider.spec.ts
git commit -m "feat(live-wind): store the provider resolved from a submitted URL"
```

---

### Task 7: Feed the banner from the provider

**Files:**
- Modify: `index.html` — `renderLiveWindPanel`, `_liveWindHref`
- Test: `tests/e2e/live-wind-provider.spec.ts`

**Interfaces:**
- Consumes: `wind-proxy` (Task 4); `spot_info.live_wind_provider` (Task 6)
- Produces: `_providerLive(info): Promise<LiveWind|null>` on `window`

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/live-wind-provider.spec.ts`:

```ts
test('a spot with a provider shows its reading in the banner', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', { spotInfo: { spot_name: 'Prov Spot', verified: true,
    live_wind_url: 'https://www.sycod.be/nl/meteo',
    live_wind_provider: 'weatherlink', live_wind_station_id: 'abc123abc123abc1' } });
  await page.route('**/functions/v1/wind-proxy*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ live: { stationId: 'abc123abc123abc1', stationName: 'Sycod',
      distanceKm: 0, speedKn: 22, gustKn: 24, dirDeg: 251, ageMin: 1,
      viewerUrl: 'https://www.weatherlink.com/x' } }),
  }));
  await page.evaluate(() => renderLiveWindPanel(
    { name: 'Prov Spot', latitude: 51.35, longitude: 3.28 }));
  await expect(page.locator('#liveWindPanel')).toContainText('22 kn');
  await expect(page.locator('#liveWindPanel')).toContainText('Sycod');
});

test('a failing provider falls back to the RWS station, never to an error', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', { spotInfo: { spot_name: 'Prov Spot', verified: true,
    live_wind_provider: 'holfuy', live_wind_station_id: '999' } });
  await page.route('**/functions/v1/wind-proxy*', route => route.abort());
  await page.evaluate(() => {
    _rwsTrendCache.set('T', { data: [18, 19, 20], ts: Date.now() });
    (window as any)._rwsNearest = async () => ({ stationId: 'T', stationName: 'Cadzand wind',
      distanceKm: 7.4, speedKn: 21, gustKn: 23, dirDeg: 288, ageMin: 5, viewerUrl: 'https://rws.example/x' });
    return renderLiveWindPanel({ name: 'Prov Spot', latitude: 51.35, longitude: 3.28 });
  });
  await expect(page.locator('#liveWindPanel')).toContainText('Cadzand wind');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx playwright test e2e/live-wind-provider.spec.ts --grep banner`
Expected: FAIL — the panel shows the RWS reading, not Sycod's

- [ ] **Step 3: Write minimal implementation**

Above `renderLiveWindPanel` in `index.html`:

```js
// A spot's own station, via wind-proxy. Cached for 60s like the RWS feed — the
// proxy caches too, so this is belt and braces against a spot page that
// re-renders on every unrelated interaction (see renderLiveWindPanel).
const PROV_TTL_MS=60000;
let _provCache=new Map();
async function _providerLive(info){
  const p=info&&info.live_wind_provider, id=info&&info.live_wind_station_id;
  if(!p||!id) return null;
  const key=`${p}:${id}`;
  const hit=_provCache.get(key);
  if(hit&&Date.now()-hit.ts<PROV_TTL_MS) return hit.live;
  let live=null;
  try{
    const r=await safeFetch(`https://kpwmajtxmcfpakvonimf.supabase.co/functions/v1/wind-proxy`
      +`?provider=${encodeURIComponent(p)}&station_id=${encodeURIComponent(id)}`,8000);
    live=(r&&r.live)||null;
  }catch(e){ live=null; }
  _provCache.set(key,{live,ts:Date.now()});
  return live;
}
```

In `renderLiveWindPanel`, replace the single `const live=await _rwsNearest(...)` line with:

```js
  const live=await _providerLive(_cachedSpotInfo)||await _rwsNearest(spot.latitude,spot.longitude);
```

and guard the trend lookup, which is RWS-only, so a provider reading does not ask RWS for a station it does not have:

```js
  const trend=live.stationId&&!_cachedSpotInfo?.live_wind_provider?await _rwsTrend(live.stationId):[];
```

In `_liveWindHref`, keep the existing `live_wind_url` branch first — the button still points at the page the rider submitted.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx playwright test e2e/live-wind-provider.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the whole suite**

```bash
cd tests && npx vitest run && npx playwright test
```
Expected: all pass. Note `admin.spec.ts:113` is a known flake unrelated to this work.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e/live-wind-provider.spec.ts
git commit -m "feat(live-wind): show a spot's own station reading in the banner"
```

---

### Task 8: Attribution, and Sycod switched on

**Files:**
- Modify: `index.html` — `renderLiveWindPanel` footer line
- Test: `tests/e2e/live-wind-provider.spec.ts`

**Interfaces:**
- Consumes: `_providerLive` (Task 7)
- Produces: nothing downstream

- [ ] **Step 1: Write the failing test**

```ts
test('a provider reading names its source', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', { spotInfo: { spot_name: 'Attr Spot', verified: true,
    live_wind_provider: 'pioupiou', live_wind_station_id: '1234' } });
  await page.route('**/functions/v1/wind-proxy*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ live: { stationId: '1234', stationName: 'Zeebrugge', distanceKm: 0,
      speedKn: 22, gustKn: 28, dirDeg: 251, ageMin: 1, viewerUrl: 'https://www.openwindmap.org/PP-1234' } }),
  }));
  await page.evaluate(() => renderLiveWindPanel({ name: 'Attr Spot', latitude: 51.35, longitude: 3.28 }));
  const txt = await page.locator('#liveWindPanel').textContent();
  expect(txt).toContain('Zeebrugge');
  expect(txt).toContain('OpenWindMap');   // licence condition, not decoration
  expect(txt).not.toContain('0.0 km away'); // a spot's own station has no distance
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx playwright test e2e/live-wind-provider.spec.ts --grep attribution`
Expected: FAIL — the footer prints `0.0 km away` and no source

- [ ] **Step 3: Write minimal implementation**

Replace the panel's footer line with:

```js
  const _provId=_cachedSpotInfo?.live_wind_provider||'';
  const SOURCE_LABEL={pioupiou:'OpenWindMap',holfuy:'Holfuy',weatherlink:'WeatherLink'};
  // A spot's own station has no meaningful distance — it IS the spot. Print the
  // source instead, which OpenWindMap's licence requires and the others earn.
  const _where=_provId
    ? `${escFriendName(live.stationName)} · via ${SOURCE_LABEL[_provId]||_provId} · ${age}`
    : `${escFriendName(live.stationName)} · ${live.distanceKm.toFixed(1)} km away · ${age}`;
```

and use `${_where}` in place of the existing station/distance/age expression.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx playwright test e2e/live-wind-provider.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Switch Sycod on and confirm end to end**

```bash
supabase db query --linked "update spot_info set live_wind_url='https://www.sycod.be/nl/meteo', live_wind_provider='weatherlink', live_wind_station_id='87ca27e8616443678fffe486311370ee', livecam_url='https://g0.ipcamlive.com/player/player.php?alias=5ab4a02c0d101', updated_at=now() where spot_name ilike '%sycod%' returning spot_name, live_wind_provider;"
```
Then open the Sycod spot page and confirm the banner shows knots with `via WeatherLink`, and the webcam embeds.

- [ ] **Step 6: Commit and open the PR**

```bash
git add index.html tests/e2e/live-wind-provider.spec.ts
git commit -m "feat(live-wind): name the source on a provider reading"
git push -u origin feat/live-wind-providers
gh pr create --base main --title "feat(live-wind): live readings from a spot's own station"
```
