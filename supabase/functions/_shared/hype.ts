// The words a reminder email says about the day, chosen by the day's tier.
//
// The templates are flat [[placeholder]] substitutions with no conditionals,
// so a "fire" day and a "chill" day cannot be told apart inside the HTML. The
// difference has to arrive in the payload. This builds it: a subject, a
// two-line headline and a tease, all tuned to the tier rateSession gave the
// day — so a Very Good, Epic or Expert-mode forecast reads like something you
// would be sorry to miss, and a Chill one does not overpromise.
//
// Pure strings, no network, so the copy for every tier is unit-tested.

export interface HypeContext {
  spot: string
  avgKn: number
  peakKn: number
  goodHours: number
  dir: string
  // "tomorrow", "today", "on Saturday" — from the reminder's ladder step.
  when: string
}

export interface Hype {
  // Hot enough for the fire template.
  fire: boolean
  subject: string
  title: string
  title_accent: string
  tease: string
}

// Spot names are user-supplied and land inside email HTML.
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const HOT_TIERS = ['expert', 'epic', 'verygood']
export const isHot = (tier: string): boolean => HOT_TIERS.includes(tier)

// Which word the ladder step puts on the day.
export function whenWord(hoursBefore: number, dayOfWeek: string): string {
  if (hoursBefore === 24) return 'tomorrow'
  if (hoursBefore < 24) return 'today'
  return `on ${dayOfWeek}`
}

export function sessionHype(tier: string, c: HypeContext): Hype {
  const spot = esc(c.spot)
  const dir = esc(c.dir)
  const avg = Math.round(c.avgKn)
  const peak = Math.round(c.peakKn)
  const h = c.goodHours
  const when = c.when
  const W = cap(when)
  const stats = `${avg} knots on average for ${h} hours, ${dir} at ${spot}`

  switch (tier) {
    case 'expert': return {
      fire: true,
      subject: `\u{1F525}\u{1F525} EXPERT MODE at ${spot} ${when} — ${avg} kts avg ${dir}`,
      title: 'Hold on tight.',
      title_accent: `Expert mode ${when}.`,
      tease: `${stats}, peaking at ${peak}. Smallest kite in the bag, biggest grin of the season. `
        + `This is the day you’ll still be talking about in winter.`,
    }
    case 'epic': return {
      fire: true,
      subject: `\u{1F525} ${spot} ${when} is EPIC — ${avg} kts avg ${dir}`,
      title: 'Cancel your plans.',
      title_accent: `${W} is epic.`,
      tease: `${stats}, peaking at ${peak}. Charge the camera, pump up early, `
        + `and don’t be the one who hears about it afterwards.`,
    }
    case 'verygood': return {
      fire: true,
      subject: `\u{1F525} Very good day at ${spot} ${when} — ${avg} kts avg ${dir}`,
      title: 'Clear your calendar.',
      title_accent: `${W} is very good.`,
      tease: `${stats}. Solid power all session long — the kind of day `
        + `that reminds you why you bought the gear.`,
    }
    case 'good': return {
      fire: false,
      subject: `\u{1F514} ${W} at ${spot} — conditions confirmed, ${avg} kts avg ${dir}`,
      title: W,
      title_accent: 'is the day.',
      tease: `${spot} is on — ${avg} knots on average for ${h} hours, ${dir}. `
        + `A proper session; bring your everyday kite.`,
    }
    case 'chill': return {
      fire: false,
      subject: `\u{1F514} ${W} at ${spot} — a chill session, ${avg} kts avg ${dir}`,
      title: W,
      title_accent: 'is a chill one.',
      tease: `${stats}. Easy-going wind — big kite, cruisy laps, no drama.`,
    }
    case 'lightwind': return {
      fire: false,
      subject: `\u{1F514} ${W} at ${spot} — light but rideable, gusts doing the work`,
      title: W,
      title_accent: 'is light, but rideable.',
      tease: `Around ${avg} knots with the gusts doing the work at ${spot}, for ${h} hours. `
        + `Bring the biggest kite you own, or the foil.`,
    }
    default: return {
      fire: false,
      subject: `${spot} — ${when}`,
      title: 'The wind gods',
      title_accent: 'aren’t cooperating.',
      tease: `${spot} ${when} is off — conditions have dropped.`,
    }
  }
}
