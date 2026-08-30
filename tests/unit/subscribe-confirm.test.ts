import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const fn = readFileSync(
  new URL('../../supabase/functions/subscribe-confirm/index.ts', import.meta.url), 'utf8')

// Assertions about what the code does must read the code, not the prose around
// it: the comment explaining that body.email is deliberately unused would
// otherwise trip the very check that looks for it.
const fnCode = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const app = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

// The confirmation email used to be POSTed from the browser straight at the
// Make webhook, so it still went out through the consumer Outlook mailbox and
// stopped arriving. Forwarding it as-is would have been worse: a function that
// mails whatever address the browser names is an open relay, and the anon key
// that reaches it is public — it ships in index.html.

describe('the recipient cannot be chosen by the caller', () => {
  it('reads the address off the verified token', () => {
    expect(fn).toContain('sb.auth.getUser(token)')
    expect(fn).toContain('email:         user.email')
    expect(fn).toContain('to: user.email')
  })

  it('never reads an email out of the request body', () => {
    // body.email would be the open relay. It must appear nowhere.
    expect(fnCode).not.toMatch(/body\.email/)
    // and the guard survives the comment-stripping, so the check is real
    expect(fnCode).toContain('user.email')
  })

  it('refuses a caller with no bearer token', () => {
    expect(fn).toMatch(/if \(!token\) return json\(\{ error: 'sign in required' \}, 401\)/)
    expect(fn).toMatch(/if \(authErr \|\| !user\?\.email\) return json/)
  })

  it('escapes what it interpolates into the email body', () => {
    expect(fn).toContain('const esc =')
    expect(fn).toContain('esc(d.date_label)')
    expect(fn).toContain('esc(d.app_link)')
  })

  it('caps the days it will render', () => {
    // An unbounded array from a caller is an unbounded email.
    expect(fn).toContain('body.days.slice(0, 16)')
  })
})

describe('the browser no longer talks to Make', () => {
  it('index.html has no Make webhook left', () => {
    expect(app).not.toContain('hook.eu1.make.com')
  })

  it('the confirmation goes through the edge function with the user token', () => {
    expect(app).toContain('/functions/v1/subscribe-confirm')
    expect(app).toMatch(/Authorization.*Bearer \$\{token\}/)
  })

  it('fireWebhook is gone rather than left dead', () => {
    expect(app).not.toContain('async function fireWebhook(')
  })
})

describe('the client ladder matches the backend', () => {
  it('creates two reminder rows per session, not five', () => {
    // The backend dropped to [24, 1] in #89 so a rider gets one email per
    // session. This copy kept [72,48,24,6,1] and went on creating all five
    // from the browser — 14 rows for a single spot — so the surviving email
    // was the 72h one, the least reliable of the five.
    const m = app.match(/const REMINDER_HOURS = \[([^\]]*)\]/)
    expect(m).toBeTruthy()
    const hours = m![1].split(',').map(s => Number(s.trim())).filter(Number.isFinite)
    expect(hours).toEqual([24, 1])
  })

  it('agrees with check-new-sessions', () => {
    const backend = readFileSync(
      new URL('../../supabase/functions/check-new-sessions/index.ts', import.meta.url), 'utf8')
    const b = backend.match(/const REMINDER_HOURS\s*=\s*\[([^\]]*)\]/)![1]
      .split(',').map(s => Number(s.trim())).filter(Number.isFinite).sort((x, y) => y - x)
    const c = app.match(/const REMINDER_HOURS = \[([^\]]*)\]/)![1]
      .split(',').map(s => Number(s.trim())).filter(Number.isFinite).sort((x, y) => y - x)
    expect(c).toEqual(b)
  })
})
