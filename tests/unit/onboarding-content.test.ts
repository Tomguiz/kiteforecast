import { describe, it, expect } from 'vitest'
import {
  resolveStage, buildNextStepHtml, type OnboardingLinks,
} from '../../supabase/functions/onboarding/content.ts'

const LINKS: OnboardingLinks = {
  app:     'https://app.test/',
  profile: 'https://app.test/?tab=profile',
  notifs:  'https://app.test/?tab=notifs',
}

describe('resolveStage', () => {
  it('sends a rider with no spot to the start', () => {
    expect(resolveStage({ favCount: 0, reminderCount: 0 })).toBe('no_spot')
  })

  // Ordered by what blocks the next action: no spot beats no reminder, even if
  // somehow a reminder exists without a favourite.
  it('treats a missing spot as more urgent than a missing reminder', () => {
    expect(resolveStage({ favCount: 0, reminderCount: 5 })).toBe('no_spot')
  })

  it('nudges a rider with a spot but no alert', () => {
    expect(resolveStage({ favCount: 1, reminderCount: 0 })).toBe('no_reminders')
  })

  it('treats a rider with both as set up', () => {
    expect(resolveStage({ favCount: 2, reminderCount: 1 })).toBe('ready')
  })

  it('does not trust negative or junk counts', () => {
    expect(resolveStage({ favCount: -3, reminderCount: -1 })).toBe('no_spot')
    expect(resolveStage({ favCount: NaN as any, reminderCount: NaN as any })).toBe('no_spot')
  })
})

describe('buildNextStepHtml', () => {
  // Unlike the what's-new email there is no empty case — a rider one day in
  // always has a sensible next action.
  it('always renders something', () => {
    for (const state of [
      { favCount: 0, reminderCount: 0 },
      { favCount: 1, reminderCount: 0 },
      { favCount: 1, reminderCount: 1 },
    ]) {
      expect(buildNextStepHtml(state, LINKS, 'Sam').length).toBeGreaterThan(100)
    }
  })

  it('asks a rider with no spot to add one', () => {
    const html = buildNextStepHtml({ favCount: 0, reminderCount: 0 }, LINKS, 'Sam')
    expect(html).toContain('START HERE')
    expect(html).toContain('Add my spot')
    expect(html).toContain(LINKS.app)
  })

  it('names the saved spot when nudging about alerts', () => {
    const html = buildNextStepHtml(
      { favCount: 1, reminderCount: 0, favNames: ['Riverwoods'] }, LINKS, 'Sam')
    expect(html).toContain('ONE MORE STEP')
    expect(html).toContain('Riverwoods')
    expect(html).toContain('Set my first alert')
  })

  it('lists several saved spots but does not run away with them', () => {
    const html = buildNextStepHtml(
      { favCount: 5, reminderCount: 0, favNames: ['A', 'B', 'C', 'D', 'E'] }, LINKS, 'Sam')
    expect(html).toContain('A, B, C')
    expect(html).not.toContain('D, E')
  })

  it('copes with a spot count but no names', () => {
    const html = buildNextStepHtml({ favCount: 1, reminderCount: 0 }, LINKS, 'Sam')
    expect(html).toContain('your spot saved')
  })

  it('congratulates a set-up rider and moves them to home location', () => {
    const html = buildNextStepHtml({ favCount: 1, reminderCount: 2 }, LINKS, 'Sam')
    expect(html).toContain("YOU'RE SET UP")
    expect(html).toContain('Add my home location')
    expect(html).toContain(LINKS.profile)
  })

  it('greets the rider by name', () => {
    expect(buildNextStepHtml({ favCount: 0, reminderCount: 0 }, LINKS, 'Gregoire'))
      .toContain('Gregoire')
  })

  it('escapes the name rather than letting it inject markup', () => {
    const html = buildNextStepHtml({ favCount: 0, reminderCount: 0 }, LINKS, '<script>x</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes spot names too', () => {
    const html = buildNextStepHtml(
      { favCount: 1, reminderCount: 0, favNames: ['<img src=x>'] }, LINKS, 'Sam')
    expect(html).not.toContain('<img')
  })

  // Free riders are the whole audience here; promising them premium features
  // as if included would be a lie in the first email they get.
  it('does not claim the free plan covers more than one spot', () => {
    const html = buildNextStepHtml({ favCount: 0, reminderCount: 0 }, LINKS, 'Sam')
    expect(html).toContain('free plan covers one spot')
  })
})
