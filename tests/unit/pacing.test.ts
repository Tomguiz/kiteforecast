import { describe, it, expect } from 'vitest'
import {
  clampDelay, clampBudget, budgetExhausted, estimateRuntimeMs, sleep,
  DEFAULT_DELAY_MS, DEFAULT_BUDGET_MS,
} from '../../supabase/functions/_shared/pacing.ts'

describe('clampDelay', () => {
  it('defaults when nothing is supplied', () => {
    expect(clampDelay(undefined)).toBe(DEFAULT_DELAY_MS)
    expect(clampDelay(null)).toBe(DEFAULT_DELAY_MS)
  })

  it('defaults on junk rather than sending as fast as possible', () => {
    // A NaN slipping through as 0 would recreate the burst this exists to stop.
    expect(clampDelay('abc')).toBe(DEFAULT_DELAY_MS)
    expect(clampDelay({})).toBe(DEFAULT_DELAY_MS)
  })

  // Number(null) and Number('') are both 0, so a caller sending {"delay_ms": null}
  // would have silently unpaced the whole blast.
  it('does not let null or empty string collapse into an unpaced run', () => {
    expect(clampDelay(null)).toBe(DEFAULT_DELAY_MS)
    expect(clampDelay('')).toBe(DEFAULT_DELAY_MS)
    expect(clampBudget(null)).toBe(DEFAULT_BUDGET_MS)
  })

  it('takes a caller-supplied gap', () => {
    expect(clampDelay(1000)).toBe(1000)
    expect(clampDelay('4000')).toBe(4000)
  })

  it('allows 0 for an explicit unpaced run', () => {
    expect(clampDelay(0)).toBe(0)
  })

  it('refuses a negative gap', () => {
    expect(clampDelay(-5000)).toBe(0)
  })

  it('caps the gap so one rider cannot stall the whole run', () => {
    expect(clampDelay(600_000)).toBe(30_000)
  })
})

describe('clampBudget', () => {
  it('defaults when nothing is supplied', () => {
    expect(clampBudget(undefined)).toBe(DEFAULT_BUDGET_MS)
  })

  it('keeps the budget inside sane bounds', () => {
    expect(clampBudget(1)).toBe(5_000)
    expect(clampBudget(9_999_999)).toBe(240_000)
  })
})

describe('budgetExhausted', () => {
  const START = 1_000_000

  it('is false at the start of a run', () => {
    expect(budgetExhausted(START, START, 110_000, 2_500)).toBe(false)
  })

  it('is false while there is room for another send plus its gap', () => {
    expect(budgetExhausted(START, START + 100_000, 110_000, 2_500)).toBe(false)
  })

  // The guard reserves the gap, so the run never starts a send it cannot record.
  it('is true once the remaining time is less than one more gap', () => {
    expect(budgetExhausted(START, START + 108_000, 110_000, 2_500)).toBe(true)
  })

  it('is true past the budget', () => {
    expect(budgetExhausted(START, START + 200_000, 110_000, 2_500)).toBe(true)
  })

  it('still reserves nothing when unpaced', () => {
    expect(budgetExhausted(START, START + 109_999, 110_000, 0)).toBe(false)
    expect(budgetExhausted(START, START + 110_000, 110_000, 0)).toBe(true)
  })
})

describe('estimateRuntimeMs', () => {
  // 27 riders at 2.5s apart is about a minute — worth reporting so an operator
  // does not think a paced run has hung.
  it('spaces gaps between sends, not after the last one', () => {
    expect(estimateRuntimeMs(27, 2_500)).toBe(65_000)
  })

  it('is zero for a single recipient', () => {
    expect(estimateRuntimeMs(1, 2_500)).toBe(0)
  })

  it('is zero for an empty run', () => {
    expect(estimateRuntimeMs(0, 2_500)).toBe(0)
    expect(estimateRuntimeMs(-3, 2_500)).toBe(0)
  })
})

describe('the whole 27-rider blast fits in one invocation', () => {
  // The case this was built for: if the default pacing could not finish the real
  // audience in one run, every send would need a manual re-invoke.
  it('completes inside the default budget', () => {
    expect(estimateRuntimeMs(27, DEFAULT_DELAY_MS)).toBeLessThan(DEFAULT_BUDGET_MS)
  })

  it('leaves headroom for the webhook round-trips too', () => {
    const perSendOverhead = 700  // observed webhook latency, generously rounded
    const total = estimateRuntimeMs(27, DEFAULT_DELAY_MS) + 27 * perSendOverhead
    expect(total).toBeLessThan(DEFAULT_BUDGET_MS)
  })
})

describe('sleep', () => {
  it('resolves immediately when unpaced', async () => {
    const t = Date.now()
    await sleep(0)
    expect(Date.now() - t).toBeLessThan(50)
  })

  it('actually waits', async () => {
    const t = Date.now()
    await sleep(60)
    expect(Date.now() - t).toBeGreaterThanOrEqual(50)
  })
})
