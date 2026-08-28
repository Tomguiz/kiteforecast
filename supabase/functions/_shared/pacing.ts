// Pacing for fan-out senders.
//
// Make's webhook answers 200 the moment it accepts a payload, before the
// scenario runs. So a sender that POSTs in a tight loop does not queue work —
// it starts N scenario runs at once, all of which reach the mail module
// simultaneously. Microsoft consumer mailboxes refuse that:
//
//   [429] Application is over its MailboxConcurrency limit.
//   [429] WASCL UserAction verdict is not None. Actual verdict is Throttle.
//
// Measured on 2026-08-28, before this existed: 15 sends failed against 9
// delivered across three bursts, every failure sharing a timestamp to the
// second. Spacing the POSTs is what keeps the mail module serial.
//
// The second job here is the runtime budget. An edge function is killed at a
// wall-clock limit, and a killed run loses whatever it had not yet recorded.
// Stopping deliberately before that, and reporting what is left, turns a
// timeout into a resumable run — the dedupe ledger means a re-run continues
// rather than repeats.

/** Gap between webhook POSTs. */
export const DEFAULT_DELAY_MS = 2_500

/**
 * Stop sending this invocation once the run has been going this long, leaving
 * headroom under the platform's hard kill so the last send still gets recorded.
 */
export const DEFAULT_BUDGET_MS = 110_000

/**
 * A caller may tune the gap, but not to something that would either hammer the
 * mailbox (0) or stall the whole run on one rider (a minute).
 */
export function clampDelay(value: unknown, fallback = DEFAULT_DELAY_MS): number {
  // null and '' both coerce to 0, which would silently disable pacing — the exact
  // failure this module exists to prevent. Treat "absent" as absent, not as zero.
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(30_000, Math.max(0, Math.floor(n)))
}

/** Same guard for the runtime budget. */
export function clampBudget(value: unknown, fallback = DEFAULT_BUDGET_MS): number {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(240_000, Math.max(5_000, Math.floor(n)))
}

/**
 * True when there is no longer room for another send plus its delay.
 *
 * Checked *before* sending rather than after, so the run never starts work it
 * cannot finish and record.
 */
export function budgetExhausted(
  startedAtMs: number, nowMs: number, budgetMs: number, delayMs: number,
): boolean {
  return (nowMs - startedAtMs) + delayMs >= budgetMs
}

/**
 * How long a run of `count` recipients will take, so a caller can report it
 * rather than leaving the operator guessing whether it hung.
 */
export function estimateRuntimeMs(count: number, delayMs: number): number {
  const n = Math.max(0, Math.floor(count))
  return n <= 1 ? 0 : (n - 1) * delayMs
}

export const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>(r => setTimeout(r, ms)) : Promise.resolve()
