// A spot with no good wind directions is invisible where it counts.
//
// hourQualifies() gates every rideable hour on isWindDirOK(), so dirs=[] means
// the spot never produces a session: no chip, no reminder, no digest line. It
// still shows up in search and can be favourited, which is the trap — the spot
// looks added, and then silently never fires. Sycod shipped exactly that way.
//
// Both creation paths therefore refuse to write a spot without a direction:
// the community "request a spot" form, and the admin add/edit form. The admin
// form is checked on edits too, because its spot_overrides upsert writes the
// toggles unconditionally and would otherwise wipe a spot's dirs.
import { test, expect } from '../fixtures/auth';

test.describe('community spot request', () => {
  test('refuses to send a spot with no wind direction picked', async ({ gotoApp, page }) => {
    await gotoApp('signedIn');
    let posted = false;
    page.on('request', r => { if (r.url().includes('spot-suggest-notify')) posted = true; });

    await page.evaluate(() => {
      showAddSpotFromHome('Dirless Bay');
      (document.getElementById('suggestLocation') as HTMLInputElement).value = 'Zeebrugge';
      (document.getElementById('suggestCountry')  as HTMLInputElement).value = 'BE';
      (document.getElementById('suggestLat')      as HTMLInputElement).value = '51.35';
      (document.getElementById('suggestLon')      as HTMLInputElement).value = '3.28';
      // every direction toggle left inactive
      return submitSpotSuggestion();
    });

    expect(posted).toBe(false);
    await expect(page.locator('.pp-toast')).toContainText('wind direction');
    // the form stays open so the rider can fix it
    await expect(page.locator('#suggestSpotWrap')).toBeVisible();
  });

  test('sends once a direction is picked', async ({ gotoApp, page }) => {
    await gotoApp('signedIn');
    const req = page.waitForRequest(r => r.url().includes('spot-suggest-notify'));

    await page.evaluate(() => {
      showAddSpotFromHome('Dirful Bay');
      (document.getElementById('suggestLocation') as HTMLInputElement).value = 'Zeebrugge';
      (document.getElementById('suggestCountry')  as HTMLInputElement).value = 'BE';
      (document.getElementById('suggestLat')      as HTMLInputElement).value = '51.35';
      (document.getElementById('suggestLon')      as HTMLInputElement).value = '3.28';
      (document.querySelector('#suggestDirBtns .s-btn') as HTMLElement).classList.add('active');
      return submitSpotSuggestion();
    });

    expect((await req).postData() || '').toContain('"dirs":"');
  });
});

test.describe('admin spot form', () => {
  // adminOpenSpot() renders into #adminEditForm, which only exists once the
  // admin tab has been rendered. A null spotName is what makes the form "new".
  async function openAdmin(page: any) {
    await page.evaluate(() => {
      loadProfile().isAdmin = true;
      if (typeof openProfilePanel === 'function') openProfilePanel('admin');
    });
    await page.waitForFunction(() => !!document.getElementById('adminEditForm'));
  }

  async function fillNewSpot(page: any, name: string) {
    await page.evaluate(async (n: string) => {
      await adminOpenSpot(null, null);
      (document.getElementById('adSpotName') as HTMLInputElement).value = n;
      (document.getElementById('adLat')      as HTMLInputElement).value = '51.35';
      (document.getElementById('adLon')      as HTMLInputElement).value = '3.28';
      (document.getElementById('adCity')     as HTMLInputElement).value = 'Zeebrugge';
      (document.getElementById('adCountry')  as HTMLInputElement).value = 'BE';
      document.querySelectorAll('#adDirBtns .s-btn.active')
        .forEach(b => b.classList.remove('active'));
    }, name);
  }

  test('will not create a spot with no direction, and writes nothing', async ({ gotoApp, page }) => {
    await gotoApp('admin');
    await openAdmin(page);
    let wrote = false;
    page.on('request', r => {
      if (r.method() !== 'GET' && /spot_info|spot_overrides/.test(r.url())) wrote = true;
    });

    await fillNewSpot(page, 'Admin Dirless');
    await page.evaluate(() => adminSaveSpotInfo());

    await expect(page.locator('.pp-toast')).toContainText('wind direction');
    expect(wrote).toBe(false);
  });

  test('creates the spot once a direction is picked, and carries the dirs', async ({ gotoApp, page }) => {
    await gotoApp('admin');
    await openAdmin(page);
    await fillNewSpot(page, 'Admin Dirful');

    await page.evaluate(() => {
      (document.querySelector('#adDirBtns .s-btn') as HTMLElement).classList.add('active');
      return adminSaveSpotInfo();
    });

    // Happy-path guard: the save goes through and the catalogue carries the
    // dirs. (This one also passed before the fix — the value of the suite is
    // in the three refusals above and below.)
    await expect.poll(() => page.evaluate(() =>
      SPOTS.find(s => s.name === 'Admin Dirful')?.dirs?.length ?? 0)).toBeGreaterThan(0);
  });

  test('an edit cannot clear the last direction off an existing spot', async ({ gotoApp, page }) => {
    await gotoApp('admin');
    await openAdmin(page);
    let wrote = false;
    page.on('request', r => {
      if (r.method() !== 'GET' && /spot_info|spot_overrides/.test(r.url())) wrote = true;
    });

    await page.evaluate(async () => {
      const spot = { spot_name: 'Edit Me', _lat: 51.35, _lon: 3.28, _loc: 'Zeebrugge, BE' };
      _adminSpots = [spot];
      await adminOpenSpot('Edit Me', spot);
      (document.getElementById('adLat') as HTMLInputElement).value = '51.35';
      (document.getElementById('adLon') as HTMLInputElement).value = '3.28';
      document.querySelectorAll('#adDirBtns .s-btn.active')
        .forEach(b => b.classList.remove('active'));
      return adminSaveSpotInfo();
    });

    await expect(page.locator('.pp-toast')).toContainText('wind direction');
    expect(wrote).toBe(false);
  });
});
