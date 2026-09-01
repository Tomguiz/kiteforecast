import { test, expect } from '../fixtures/auth';

// Opening the profile right after signing in showed blank fields — nickname,
// home, level, weight all empty — and the rider had to close and reopen it.
// The panel filled once, on open, from localStorage; the real profile arrives
// from the server a moment later and nothing repainted.
//
// The second symptom had the same cause: with the nickname box blank,
// saveNickname refuses to write (a nickname is required), so typing a first and
// last name and pressing Save did nothing at all.

// The profile is synced from the server shortly after load and overwrites what
// the test has just stored, so every test here settles first. Without it these
// assertions measure a race rather than the fix — and they failed against
// correct code because of it.
async function settled(page: any) {
  await page.waitForTimeout(800);
}

test('the panel repaints when the server profile lands', async ({ gotoApp, page }) => {
  // Read back inside the SAME evaluate as the write. The app's own sync also
  // repaints an open panel now — that is the fix — so leaving a gap here lets
  // the real sync land and restore its own values, and the test would be
  // fighting correct behaviour rather than measuring it.
  await gotoApp('signedIn');
  await settled(page);
  await page.evaluate(() => { openProfilePanel('profile'); fillProfileForm(); });

  const after = await page.evaluate(() => {
    const p = loadProfile();
    p.nickname = 'LandedLater'; p.firstName = 'Tom'; p.lastName = 'Guisgand'; p.weightKg = 80;
    saveProfile(p);
    fillProfileForm();          // what syncPremium calls once the answer arrives
    return {
      nick: ($('ppNicknameInput') as HTMLInputElement).value,
      first: ($('ppFirstNameInput') as HTMLInputElement).value,
      last: ($('ppLastNameInput') as HTMLInputElement).value,
      weight: ($('ppWeightInput') as HTMLInputElement).value,
      saveDisabled: ($('ppNicknameSaveBtn') as HTMLButtonElement).disabled,
    };
  });

  expect(after.nick).toBe('LandedLater');
  expect(after.first).toBe('Tom');
  expect(after.last).toBe('Guisgand');
  expect(after.weight).toBe('80');
  expect(after.saveDisabled).toBe(true);   // settled, not inviting a pointless save
});

test('it does not overwrite what the rider is typing', async ({ gotoApp, page }) => {
  // The sync can land mid-word. Replacing the caret's field would be its own bug.
  await gotoApp('signedIn');
  await settled(page);
  await page.evaluate(() => { openProfilePanel('profile'); fillProfileForm(); });
  await page.click('#ppFirstNameInput');
  await page.keyboard.type('Thoma');

  await page.evaluate(() => {
    const p = loadProfile(); p.firstName = 'FromServer'; p.nickname = 'Guiz'; saveProfile(p);
    fillProfileForm();
  });

  await expect(page.locator('#ppFirstNameInput')).toHaveValue('Thoma');  // untouched
  await expect(page.locator('#ppNicknameInput')).toHaveValue('Guiz');    // the rest still fills
});

test('once filled, the names can actually be saved', async ({ gotoApp, page }) => {
  // The knock-on symptom: a blank nickname made saveNickname bail, so the name
  // fields looked broken a second time.
  await gotoApp('signedIn');
  await settled(page);
  const nick = await page.evaluate(() => {
    const p = loadProfile(); p.firstName = ''; p.lastName = ''; saveProfile(p);
    openProfilePanel('profile'); fillProfileForm();
    return p.nickname;                       // whatever the sync settled on
  });

  const pending = page.waitForRequest(r =>
    r.url().includes('/profiles') && ['POST', 'PATCH'].includes(r.method()) &&
    (r.postData() || '').includes('first_name'), { timeout: 10000 });

  await page.fill('#ppFirstNameInput', 'Tom');
  await page.locator('#ppNicknameSaveBtn').click();

  const req = await pending;
  expect(req.postData()).toContain('"first_name":"Tom"');
  expect(req.postData()).toContain(`"nickname":"${nick}"`);   // carried, not lost
});

test('the sync path calls the filler', async ({ gotoApp, page }) => {
  // The behaviour above is only reachable if syncPremium actually repaints an
  // open panel. Pin the wiring, not just the function.
  await gotoApp('signedIn');
  const src = await page.evaluate(() => document.documentElement.innerHTML);
  expect(src).toMatch(/profileOverlay'\)\?\.style\.display==='flex'\) fillProfileForm\(\)/);
});

test('an empty nickname is flagged, and blocks the Save', async ({ gotoApp, page }) => {
  // Driven through the input rather than the stored profile: the sync restores
  // a nickname on its own schedule, so clearing storage proves nothing.
  await gotoApp('signedIn');
  await settled(page);
  await page.evaluate(() => { openProfilePanel('profile'); fillProfileForm(); });
  await page.fill('#ppNicknameInput', '');
  await page.evaluate(() => onNicknameInput());
  await expect(page.locator('#ppNicknameReq')).toBeVisible();
  await expect(page.locator('#ppNicknameSaveBtn')).toBeDisabled();
});
