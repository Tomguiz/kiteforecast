import { test, expect } from '../fixtures/auth';

// The shared slide-out panel: feature sections (Friends, Notifications, …) open
// on the LEFT (same side as the burger menu); the Profile sheet stays on the
// RIGHT. Controlled by the `pp-left` class on #profileOverlay.

test.describe('desktop', () => {
  test.use({ viewport: { width: 1200, height: 800 } });

  test('Profile opens on the right, feature sections on the left', async ({ gotoApp, page }) => {
    await gotoApp('signedIn');

    const side = () => page.evaluate(() => {
      const ov = document.getElementById('profileOverlay')!;
      const r = document.getElementById('profilePanel')!.getBoundingClientRect();
      return { ppLeft: ov.classList.contains('pp-left'), atLeftEdge: Math.round(r.left) === 0, atRightEdge: Math.round(r.right) === window.innerWidth };
    });

    // Profile → right edge.
    await page.evaluate(() => openProfilePanel('profile'));
    let s = await side();
    expect(s.ppLeft).toBe(false);
    expect(s.atRightEdge).toBe(true);

    // Friends → left edge.
    await page.evaluate(() => openProfilePanel('friends'));
    s = await side();
    expect(s.ppLeft).toBe(true);
    expect(s.atLeftEdge).toBe(true);

    // Notifications (another section) → left too.
    await page.evaluate(() => openProfilePanel('notifs'));
    expect((await side()).ppLeft).toBe(true);

    // Switching back to Profile → right again.
    await page.evaluate(() => openProfilePanel('profile'));
    s = await side();
    expect(s.ppLeft).toBe(false);
    expect(s.atRightEdge).toBe(true);
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mobile stays a bottom sheet — the left/right toggle does not affect it', async ({ gotoApp, page }) => {
    await gotoApp('signedIn');

    const read = () => page.evaluate(() => {
      const ov = document.getElementById('profileOverlay')!;
      return {
        align: getComputedStyle(ov).alignItems,                 // bottom sheet → flex-end
        left: Math.round(document.getElementById('profilePanel')!.getBoundingClientRect().left),
      };
    });

    // Feature section: overlay is aligned to the bottom (a sheet). The key point
    // is that the pp-left class must NOT shift the panel horizontally on mobile.
    await page.evaluate(() => openProfilePanel('friends'));
    const fr = await read();
    expect(fr.align).toBe('flex-end');

    // Profile: identical bottom-sheet placement — same horizontal position as the
    // feature section (pp-left has no effect below the desktop breakpoint).
    await page.evaluate(() => openProfilePanel('profile'));
    const pr = await read();
    expect(pr.align).toBe('flex-end');
    expect(pr.left).toBe(fr.left);
  });
});
