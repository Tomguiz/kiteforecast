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

  test('wind-proxy takes no URL parameter — it cannot be aimed at a host', async () => {
    const ctx = await request.newContext();
    // Not the metadata address (169.254.169.254): Cloudflare's WAF rejects that
    // literal at the edge on *.supabase.co, so a test using it would pass or fail
    // for reasons entirely outside this codebase. `example.invalid` is a reserved
    // TLD that can never resolve — if the url param were ever honoured, the fetch
    // would fail loudly (network error) rather than silently succeeding, so a 200
    // with no trace of it in the body proves the function built its upstream URL
    // from its own fixed template and never touched caller input.
    const res = await ctx.get(
      `${BASE}/wind-proxy?provider=holfuy&station_id=1&url=http://example.invalid/`,
      { headers: { Authorization: `Bearer ${ANON}` } });
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain('example.invalid');
    await ctx.dispose();
  });
});
