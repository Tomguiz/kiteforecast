import { test, expect, request } from '@playwright/test';

// Smoke tests for the deployed edge functions' SECURITY gates (auth, SSRF, CORS).
// These hit the live functions read-only — they assert rejections, never mutate.
const BASE = 'https://kpwmajtxmcfpakvonimf.supabase.co/functions/v1';
// Public anon key (ships in the client) — used to reach the functions as "anon".
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtwd21hanR4bWNmcGFrdm9uaW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTcyMjYsImV4cCI6MjA5MDczMzIyNn0.QfQuIQbnfVUOApPbOdvCRbNsVdb0SBAwMX-hvioGJmg';

test.describe('edge function security gates', () => {
  test('verify-premium rejects unauthenticated callers', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BASE}/verify-premium`, {
      headers: { Authorization: `Bearer ${ANON}` },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('stripe-checkout rejects unauthenticated callers', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BASE}/stripe-checkout`, {
      headers: { Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      data: { email: 'attacker@example.com' },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('stripe-portal rejects unauthenticated callers', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BASE}/stripe-portal`, {
      headers: { Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      data: { email: 'attacker@example.com' },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('spot-autofill rejects unauthenticated callers', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BASE}/spot-autofill`, {
      headers: { Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      data: { url: 'https://example.com' },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('wind-proxy refuses an unknown provider', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/wind-proxy?provider=evil&station_id=1`, {
      headers: { Authorization: `Bearer ${ANON}` },
    });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });

  test('wind-proxy rejects a prototype-chain provider instead of 500ing', async () => {
    const ctx = await request.newContext();
    // "constructor"/"toString"/"__proto__" resolve through Object.prototype on a
    // plain {} lookup table. If the provider/station-id maps aren't built with a
    // null prototype (or an equivalent hasOwn/Set guard), these slugs sail past
    // the provider-existence check and the id-format regex test throws on a
    // non-RegExp value — outside the handler's try/catch, so it would 500 instead
    // of degrading to a rejection. Every failure must degrade, never surface as
    // a server error.
    for (const provider of ['constructor', 'toString']) {
      const res = await ctx.get(`${BASE}/wind-proxy?provider=${provider}&station_id=1`, {
        headers: { Authorization: `Bearer ${ANON}` },
      });
      expect(res.status()).toBe(400);
    }
    await ctx.dispose();
  });

  test('wind-proxy takes no URL parameter — it cannot be aimed at a host', async () => {
    const ctx = await request.newContext();
    // Not the metadata address (169.254.169.254): Cloudflare's WAF rejects that
    // literal at the edge on *.supabase.co, so a test using it would pass or fail
    // for reasons entirely outside this codebase. `example.invalid` is a reserved,
    // unresolvable TLD instead.
    //
    // A weaker version of this test (any provider/station_id + assert 200 + body
    // doesn't echo the url) does NOT distinguish "url ignored" from "url honoured
    // but safely failed": a function that fetched example.invalid would hit a DNS
    // error, degrade to {live:null} per the failure-degrades-to-null rule, and
    // produce an identical response. So instead this hits a REAL known-good
    // station alongside the url param and asserts a genuine reading comes back —
    // if the url were ever honoured instead of the fixed per-provider template,
    // the fetch would go to the unresolvable host and `live` would be null. This
    // is the only way to discriminate the two behaviours from outside the
    // function, which is also why it depends on a live third-party station
    // (Sycod's public weatherlink feed) being reachable — deliberate, not
    // incidental flakiness.
    const res = await ctx.get(
      `${BASE}/wind-proxy?provider=weatherlink&station_id=87ca27e8616443678fffe486311370ee&url=http://example.invalid/`,
      { headers: { Authorization: `Bearer ${ANON}` } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.live).not.toBeNull();
    expect(body.live.stationName).toBe('Sycod');
    await ctx.dispose();
  });
});
