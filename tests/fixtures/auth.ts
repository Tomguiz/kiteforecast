import { test as base, expect, type Page } from '@playwright/test';
import { mockSupabase, type MockOptions } from './supabase-mock';
import { TEST_EMAIL, ADMIN_EMAIL } from './seed-data';

type AppState = 'signedOut' | 'signedIn' | 'premium' | 'admin';

function profileSeed(state: AppState) {
  if (state === 'signedOut') return null;
  if (state === 'admin') return { email: ADMIN_EMAIL, nickname: 'Admin', isAdmin: true };
  if (state === 'premium') return { email: TEST_EMAIL, nickname: 'Tester', isPremium: true };
  return { email: TEST_EMAIL, nickname: 'Tester' };
}

function mockOpts(state: AppState, extra: Partial<MockOptions> = {}): MockOptions {
  return {
    email: state === 'admin' ? ADMIN_EMAIL : TEST_EMAIL,
    isPremium: state === 'premium',
    isAdmin: state === 'admin',
    ...extra,
  };
}

export const test = base.extend<{
  gotoApp: (state: AppState, extra?: Partial<MockOptions>) => Promise<Page>;
}>({
  gotoApp: async ({ page }, use) => {
    await use(async (state, extra = {}) => {
      await mockSupabase(page, mockOpts(state, extra));
      const seed = profileSeed(state);
      if (seed) {
        const email = state === 'admin' ? ADMIN_EMAIL : TEST_EMAIL;
        await page.addInitScript((args) => {
          const { p, email } = args as { p: unknown; email: string };
          localStorage.setItem('kf_profile', JSON.stringify(p));
          // Seed a Supabase session so the client restores an AUTHENTICATED
          // session (token present) — without this, queries go out as `anon`
          // and identity-scoped RLS returns nothing, mirroring an expired login.
          const farFuture = 4102444800; // 2100-01-01
          localStorage.setItem('kf-auth', JSON.stringify({
            access_token: 'test-token', token_type: 'bearer',
            expires_at: farFuture, expires_in: 3600, refresh_token: 'test-refresh',
            user: { id: 'test-uid', email, role: 'authenticated' },
          }));
        }, { p: seed, email });
      }
      await page.goto('/index.html');
      return page;
    });
  },
});

export { expect };
