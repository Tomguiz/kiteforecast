import { test, expect } from '../fixtures/auth';

// Root-cause regression for "Uncaught TypeError: _chipQueue.queue.shift(...) is
// not a function" on the homepage.
//
// Nothing but functions is ever pushed onto _chipQueue.queue — the non-function
// is `undefined`, returned by shifting an ALREADY EMPTY queue. Commit 6b4b396
// ("Fix HTTP 429 rate limiting") split the drain's check-then-act across a
// timer:
//
//   if(queue.length) setTimeout(()=>queue.shift()(),400)
//
// The length is checked now, the shift happens 400ms later. Two settling
// fetches can both see length===1 and both arm a timer; the first shift takes
// the entry, the second shifts `undefined` and throws.
//
// The two drain chains exist because the drain timer calls run() without
// re-checking `running<max`, and because a queuedFetch() arriving inside the
// 400ms gap sees running===0 and starts immediately. So `running` climbs above
// `max` — the concurrency cap that commit added to stop Open-Meteo 429s stops
// holding. That, not the swallowed throw, is the damage.
//
// Both facts are asserted below: the cap must hold, and the drain must not throw.

// App globals — inline in index.html, and `_chipQueue` is a top-level `const`
// so it lives in the global lexical scope rather than on `window`.
declare const _chipQueue: { running: number; max: number; queue: unknown[] };
declare function queuedFetch(fn: () => Promise<unknown>): Promise<unknown>;

// Drive the queue with synthetic tasks (no network) so the race is deterministic.
async function runQueueRace(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const q = _chipQueue;

    // Let the homepage's own chip fetches finish so we start from an idle queue.
    const idle = async () => {
      for (let i = 0; i < 200; i++) {
        if (q.running === 0 && q.queue.length === 0) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };
    if (!await idle()) return { startedIdle: false, peak: 0, settled: 0, pending: 0 };

    let peak = 0;
    const watch = setInterval(() => { if (q.running > peak) peak = q.running; }, 5);

    const task = (ms: number) => queuedFetch(() => new Promise((r) => setTimeout(r, ms)));

    // A batch of chip fetches: the first runs, the rest queue behind it.
    const promises = [task(300), task(300), task(300), task(300)];

    // The homepage does not enqueue all its chips in one tick — more arrive as
    // sections render. Inject during the 400ms gaps between queued fetches
    // (300ms task + 400ms delay = a ~700ms cadence, so gaps open at 300-700ms
    // and 1000-1400ms). Wall-clock timing, deliberately: a trigger that read
    // q.running would stop firing once the slot is claimed correctly.
    let injected = 0;
    const inject = (at: number) => setTimeout(() => { injected++; promises.push(task(50)); }, at);
    const timers = [inject(450), inject(1150)];

    const settled = await Promise.race([
      // allSettled is re-read from `promises` after the injections land.
      new Promise<number>((r) => setTimeout(() => Promise.allSettled(promises).then(() => r(promises.length)), 1200)),
      new Promise<number>((r) => setTimeout(() => r(-1), 15000)),
    ]);

    clearInterval(watch);
    timers.forEach(clearTimeout);
    return { startedIdle: true, injected, peak, max: q.max, settled, pending: q.queue.length, running: q.running };
  });
}

test('chip queue never exceeds its concurrency cap and drains without throwing', async ({ gotoApp, page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Keep the homepage's own chip fetches off the network and fast to settle.
  await page.route(/.*api\.open-meteo\.com\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"error":true,"reason":"stubbed"}' }));
  await page.route(/.*marine-api\.open-meteo\.com\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"error":true,"reason":"stubbed"}' }));

  await gotoApp('signedOut');

  const r = await runQueueRace(page);

  expect(r.startedIdle, 'chip queue should reach idle after the homepage loads').toBe(true);
  expect(r.injected, 'both mid-drain injections must land before the run ends').toBe(2);

  // Every queued fetch must resolve — a queued run that is never invoked leaves
  // its chip promise pending forever and the badge never loads.
  expect(r.settled, 'every queued fetch must settle').toBeGreaterThan(0);
  expect(r.pending, 'queue must fully drain').toBe(0);
  expect(r.running, 'running count must return to zero').toBe(0);

  // The reported symptom: a drain shifting `undefined` off an empty queue.
  expect(errors.join(' | ')).not.toContain('is not a function');
  expect(errors).toEqual([]);

  // The cap is the whole point of the queue: exceeding it is what triggers 429s.
  expect(r.peak, `concurrency exceeded max (${r.max})`).toBeLessThanOrEqual(r.max);
});
