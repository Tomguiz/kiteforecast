import { test, expect } from '../fixtures/auth';

// The day-detail modal shows a drag handle on mobile, implying swipe-to-dismiss.
// These tests use a mobile viewport + touch and drive the modal directly (it
// normally needs live forecast data to populate).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function showModal(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const ov = document.getElementById('modalOverlay')!;
    ov.style.display = 'flex';
    const m = document.getElementById('modal')!;
    m.style.transform = ''; m.style.transition = '';
  });
}

test('swiping the handle down past the threshold closes the modal', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await showModal(page);
  const overlay = page.locator('#modalOverlay');
  await expect(overlay).toBeVisible();

  const handle = page.locator('#modal .m-handle');
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle not visible');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // simulate a downward drag of ~250px (well past the 120px close threshold)
  await page.touchscreen.tap(cx, cy); // ensure touch is initialised
  await page.evaluate(({ cx, cy }) => {
    const el = document.querySelector('#modal .m-handle')!;
    const t = (y: number) => new TouchEvent('touchmove', {
      bubbles: true, cancelable: true,
      touches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: y })],
    } as any);
    el.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true,
      touches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })],
    } as any));
    el.dispatchEvent(t(cy + 130));
    el.dispatchEvent(t(cy + 260));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true } as any));
  }, { cx, cy });

  // modal animates out then closeModal hides the overlay
  await expect(overlay).toBeHidden({ timeout: 1500 });
});

test('a small drag snaps back (does not close)', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await showModal(page);
  const overlay = page.locator('#modalOverlay');
  const handle = page.locator('#modal .m-handle');
  const box = (await handle.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.evaluate(({ cx, cy }) => {
    const el = document.querySelector('#modal .m-handle')!;
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true,
      touches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })] } as any));
    el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true,
      touches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy + 40 })] } as any)); // < 120 threshold
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true } as any));
  }, { cx, cy });

  // stays open
  await page.waitForTimeout(400);
  await expect(overlay).toBeVisible();
});
