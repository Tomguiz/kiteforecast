import { test, expect } from '../fixtures/auth';

// The "Send" toggle notifies accepted friends, but session-attend-notify skips
// any friend whose own "Receive" toggle is off. These specs cover the row that
// surfaces that difference, so "my friends" is never mistaken for "my friends
// who actually get the email".

// Stub the premium check and the friends_notif_status RPC, then render.
async function seedReach(
  page: any,
  friends: Array<{ email: string; nickname: string | null; receives: boolean }>,
  opts: { premium?: boolean; sendingOn?: boolean } = {},
) {
  const { premium = true, sendingOn = true } = opts;
  await page.evaluate(
    ({ friends, premium, sendingOn }: any) => {
      // @ts-expect-error app global
      window.isPremium = () => premium;
      const p = JSON.parse(localStorage.getItem('kf_profile') || '{}');
      p.email = p.email || 'me@example.com';
      p.notifyFriendsOnConfirm = sendingOn;
      localStorage.setItem('kf_profile', JSON.stringify(p));
      // @ts-expect-error app global — renderFriendsReach also counts pending
      // requests via from('friendships'), so the stub must model both calls.
      window.getSb = () => ({
        rpc: async () => ({ data: friends, error: null }),
        from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ count: 0, error: null }) }) }) }),
      });
      // @ts-expect-error app global — reset the module-level cache between specs
      window._friendsReachCache = null;
    },
    { friends, premium, sendingOn },
  );
  // The row lives inside the Notifications section — it has to be open for
  // visibility assertions to mean anything.
  await page.evaluate(() => {
    // @ts-expect-error app global
    if (typeof openProfilePanel === 'function') openProfilePanel('notifs');
  });
  await page.evaluate(() => {
    // @ts-expect-error app global
    return renderFriendsReach();
  });
}

const THREE = [
  { email: 'a@x.com', nickname: 'Vass',  receives: true },
  { email: 'b@x.com', nickname: 'Yoann', receives: true },
  { email: 'c@x.com', nickname: 'Ruben', receives: false },
];

test('summarises how many friends actually receive the alert', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedReach(page, THREE);

  await expect(page.locator('#ppFriendsReachRow')).toBeVisible();
  await expect(page.locator('#ppFriendsReachSummary')).toContainText('2 of 3');
  await expect(page.locator('#ppFriendsReachSummary')).toContainText('will be notified');
});

test('expanding lists who receives and who opted out', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedReach(page, THREE);

  // Collapsed by default.
  await expect(page.locator('#ppFriendsReachList')).toBeHidden();

  await page.locator('#ppFriendsReachSummary').click();
  await expect(page.locator('#ppFriendsReachList')).toBeVisible();
  await expect(page.locator('#ppFriendsReachList')).toContainText('Vass');
  await expect(page.locator('#ppFriendsReachList')).toContainText('Yoann');
  // The opt-out is named and given a reason, not silently dropped.
  await expect(page.locator('#ppFriendsReachList')).toContainText('Ruben');
  await expect(page.locator('#ppFriendsReachList')).toContainText('Receive');
});

test('says nobody is notified when my own sending toggle is off', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedReach(page, THREE, { sendingOn: false });

  await expect(page.locator('#ppFriendsReachSummary')).toContainText('Nobody');
  await expect(page.locator('#ppFriendsReachSummary')).toContainText('sending is off');
});

test('hides the row entirely for non-premium users', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedReach(page, THREE, { premium: false });

  await expect(page.locator('#ppFriendsReachRow')).toBeHidden();
});

test('hides the row when the user has no accepted friends', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedReach(page, []);

  await expect(page.locator('#ppFriendsReachRow')).toBeHidden();
});

test('escapes nicknames rather than injecting them as HTML', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedReach(page, [
    { email: 'x@x.com', nickname: '<img src=x onerror=alert(1)>', receives: true },
  ]);
  await page.locator('#ppFriendsReachSummary').click();

  // The nickname must land as text, with no injected element.
  await expect(page.locator('#ppFriendsReachList')).toContainText('<img src=x');
  expect(await page.locator('#ppFriendsReachList img').count()).toBe(0);
});

test('falls back to the email local-part when a friend has no nickname', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedReach(page, [{ email: 'sofie@example.com', nickname: null, receives: true }]);
  await page.locator('#ppFriendsReachSummary').click();

  await expect(page.locator('#ppFriendsReachList')).toContainText('sofie');
});

test('explains pending requests so the count does not look wrong', async ({ gotoApp, page }) => {
  // The Friends panel lists pending requests too, so "0 of 1" beside a dozen
  // names reads as a bug unless the pending ones are accounted for.
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // @ts-expect-error app global
    window.isPremium = () => true;
    const p = JSON.parse(localStorage.getItem('kf_profile') || '{}');
    p.email = 'me@example.com'; p.notifyFriendsOnConfirm = true;
    localStorage.setItem('kf_profile', JSON.stringify(p));
    // @ts-expect-error app global
    window.getSb = () => ({
      rpc: async () => ({ data: [{ email: 'r@x.com', nickname: 'Ruben', receives: false }], error: null }),
      from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ count: 11, error: null }) }) }) }),
    });
    // @ts-expect-error app global
    window._friendsReachCache = null;
    // @ts-expect-error app global
    openProfilePanel('notifs');
  });
  await page.evaluate(() => {
    // @ts-expect-error app global
    return renderFriendsReach();
  });
  await page.locator('#ppFriendsReachSummary').click();

  await expect(page.locator('#ppFriendsReachSummary')).toContainText('0 of 1');
  await expect(page.locator('#ppFriendsReachSummary')).toContainText('accepted friend');
  await expect(page.locator('#ppFriendsReachList')).toContainText('11 pending requests');
});
