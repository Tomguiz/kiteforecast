import { test, expect } from '../fixtures/auth';

// Riders are found by nickname, which is often nothing like the name their
// friends know them by. First and last name are optional additions to the
// same identity block, searched alongside the nickname.

test('the profile offers first and last name', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => openProfilePanel('profile'));
  await expect(page.locator('#ppFirstNameInput')).toBeVisible();
  await expect(page.locator('#ppLastNameInput')).toBeVisible();
});

test('they are saved with the nickname, in one write', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => openProfilePanel('profile'));

  const pending = page.waitForRequest(r =>
    r.url().includes('/profiles') && ['POST', 'PATCH'].includes(r.method()) &&
    (r.postData() || '').includes('first_name'), { timeout: 10000 });

  await page.fill('#ppFirstNameInput', 'Damien');
  await page.fill('#ppLastNameInput', 'Fra');
  await page.fill('#ppNicknameInput', 'dfx92');
  await page.evaluate(() => saveNickname(false));

  const req = await pending;
  expect(req.postData()).toContain('"first_name":"Damien"');
  expect(req.postData()).toContain('"last_name":"Fra"');
  expect(req.postData()).toContain('"nickname":"dfx92"');
});

test('an empty name is stored as null, not an empty string', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => openProfilePanel('profile'));
  const pending = page.waitForRequest(r =>
    r.url().includes('/profiles') && ['POST', 'PATCH'].includes(r.method()) &&
    (r.postData() || '').includes('first_name'), { timeout: 10000 });
  await page.fill('#ppFirstNameInput', '   ');
  await page.fill('#ppNicknameInput', 'solo');
  await page.evaluate(() => saveNickname(false));
  const req = await pending;
  expect(req.postData()).toContain('"first_name":null');
});

test('the search asks about names as well as nicknames', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => openProfilePanel('friends'));
  const pending = page.waitForRequest(r => r.url().includes('public_profiles'), { timeout: 10000 });
  await page.evaluate(() => doFriendSearch('Damien'));
  const url = decodeURIComponent((await pending).url());
  expect(url).toContain('nickname.ilike.%Damien%');
  expect(url).toContain('first_name.ilike.%Damien%');
  expect(url).toContain('last_name.ilike.%Damien%');
});

test('a comma cannot break the filter it is searched with', async ({ gotoApp, page }) => {
  // or() separates on commas. A query containing one would otherwise build a
  // malformed filter rather than searching for the text.
  await gotoApp('signedIn');
  await page.evaluate(() => openProfilePanel('friends'));
  const pending = page.waitForRequest(r => r.url().includes('public_profiles'), { timeout: 10000 });
  await page.evaluate(() => doFriendSearch('Fra,Damien'));
  // decodeURIComponent leaves the query-string '+' alone — that is form
  // encoding, not percent encoding — so normalise it before asserting.
  const url = decodeURIComponent((await pending).url()).replace(/\+/g, ' ');
  expect(url).toContain('nickname.ilike.%Fra Damien%');   // the comma became a space
  expect(url).not.toMatch(/ilike\.%Fra,/);                // and never a separator
  // exactly three filters, so the comma did not add a fourth
  expect((url.match(/ilike\./g) || []).length).toBe(3);
});

test('the placeholder says what can be searched', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => openProfilePanel('friends'));
  await expect(page.locator('#friendSearchInput')).toHaveAttribute('placeholder', /name or nickname/i);
});
