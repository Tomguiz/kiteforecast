import { test, expect } from '../fixtures/auth';

// The first/last name fields share the nickname's Save button. That button was
// enabled only when the NICKNAME changed, and disabled otherwise — so once a
// rider's nickname was settled, they could type their name and had no way at
// all to commit it. The names shipped unsaveable.

async function openProfile(page: any) {
  await page.evaluate(() => openProfilePanel('profile'));
  await page.waitForSelector('#ppFirstNameInput');
  // The profile is synced from the server a moment after load, which can
  // replace a nickname set by the test. Settle first, then align the inputs to
  // whatever is actually stored, so "nothing has changed yet" is really true.
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const p = loadProfile();
    $('ppNicknameInput').value  = p.nickname || 'Guiz';
    $('ppFirstNameInput').value = p.firstName || '';
    $('ppLastNameInput').value  = p.lastName || '';
    onNicknameInput();
  });
}

test('typing a name wakes the Save button', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    const p = loadProfile(); p.firstName = ''; p.lastName = ''; saveProfile(p);
  });
  await openProfile(page);

  const btn = page.locator('#ppNicknameSaveBtn');
  await expect(btn).toBeDisabled();                 // nothing changed yet

  await page.fill('#ppFirstNameInput', 'Tom');
  await expect(btn).toBeEnabled();
  await expect(btn).toHaveText('Save');
});

test('the last name wakes it too', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    const p = loadProfile(); p.firstName = 'Tom'; p.lastName = ''; saveProfile(p);
  });
  await openProfile(page);
  await expect(page.locator('#ppNicknameSaveBtn')).toBeDisabled();
  await page.fill('#ppLastNameInput', 'Guisgand');
  await expect(page.locator('#ppNicknameSaveBtn')).toBeEnabled();
});

test('and the name actually reaches the database', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    const p = loadProfile(); p.firstName = ''; p.lastName = ''; saveProfile(p);
  });
  await openProfile(page);

  const pending = page.waitForRequest(r =>
    r.url().includes('/profiles') && ['POST', 'PATCH'].includes(r.method()) &&
    (r.postData() || '').includes('first_name'), { timeout: 10000 });

  await page.fill('#ppFirstNameInput', 'Tom');
  await page.fill('#ppLastNameInput', 'Guisgand');
  await page.locator('#ppNicknameSaveBtn').click();

  const req = await pending;
  expect(req.postData()).toContain('"first_name":"Tom"');
  expect(req.postData()).toContain('"last_name":"Guisgand"');
  expect(req.postData()).toMatch(/"nickname":"[^"]+"/);    // carried, not lost
});

test('an empty nickname still cannot be saved, whatever the names say', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openProfile(page);
  await page.evaluate(() => { $('ppNicknameInput').value = ''; onNicknameInput(); });
  await page.fill('#ppFirstNameInput', 'Tom');
  await expect(page.locator('#ppNicknameSaveBtn')).toBeDisabled();
});

test('after saving, the button settles back', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => { const p = loadProfile(); p.firstName = ''; saveProfile(p); });
  await openProfile(page);
  await page.fill('#ppFirstNameInput', 'Tom');
  await page.locator('#ppNicknameSaveBtn').click();
  await expect(page.locator('#ppNicknameSaveBtn')).toHaveText('✓ Saved');
  await expect(page.locator('#ppNicknameSaveBtn')).toBeDisabled();
});
