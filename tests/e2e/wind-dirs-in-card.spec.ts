import { test, expect } from '../fixtures/auth';

// The good-wind-dirs block used to occupy its own full-width band under the
// spot-info card — a whole row of mobile vertical space to show five short
// chips. It now lives inside the card body, freeing that space for the live
// wind panel, with a summary in the collapsed subtitle so the directions are
// still glanceable without expanding.

async function openSpot(page: any) {
  await page.evaluate(async () => {
    // @ts-expect-error app global
    await (window as any)._spotsReady;
    // @ts-expect-error app global
    windDirs = new Set([0, 45, 225, 270, 315]);
    // @ts-expect-error app global
    renderWindDirChips();
    // @ts-expect-error app global
    await renderSpotInfoCard('Riverwoods Beachclub');
  });
}

test('the wind-dirs block sits inside the spot-info card body', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openSpot(page);

  // Either card body counts: claimed spots render .spot-info-body, unclaimed
  // ones render .spot-info-unclaimed. The requirement is "inside the card".
  const inside = await page.evaluate(() =>
    !!document.querySelector('.spot-info-card #locWindDirs'));
  expect(inside).toBe(true);
});

test('it is no longer a standalone band under the card', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openSpot(page);

  // Its old home was a direct sibling of #spotInfoCard.
  const isSibling = await page.evaluate(() => {
    const card = document.getElementById('spotInfoCard');
    return Array.from(card?.parentElement?.children ?? []).some(c => c.id === 'locWindDirs');
  });
  expect(isSibling).toBe(false);
});

test('the collapsed card still shows the directions at a glance', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openSpot(page);

  await expect(page.locator('.spot-info-subtitle')).toContainText('N/NE/SW/W/NW');
});

test('the chips survive a spot-info re-render', async ({ gotoApp, page }) => {
  // The block is MOVED, not re-created — index.html keeps it outside the card's
  // async innerHTML for exactly this reason. A re-render must not empty it.
  await gotoApp('signedIn');
  await openSpot(page);

  await page.evaluate(async () => {
    // @ts-expect-error app global
    await renderSpotInfoCard('Riverwoods Beachclub');
  });

  const chips = await page.locator('.spot-info-card #locWindDirs .s-btn').count();
  expect(chips).toBe(5);
});

test('its redundant mobile toggle row is hidden inside the card', async ({ gotoApp, page }) => {
  // The card is already the disclosure; a second collapse inside it would be
  // two chevrons doing the same job.
  await gotoApp('signedIn');
  await openSpot(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.locator('#locWindDirs')).toHaveClass(/lwd-in-card/);
  await expect(page.locator('#lwdToggle')).toBeHidden();
});
