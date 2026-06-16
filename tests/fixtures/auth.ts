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
        await page.addInitScript((p) => {
          localStorage.setItem('kf_profile', JSON.stringify(p));
        }, seed);
      }
      await page.goto('/index.html');
      return page;
    });
  },
});

export { expect };
