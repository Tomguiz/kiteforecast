import { describe, it, expect } from 'vitest'
import {
  handleUnsubscribe, type UnsubscribeDb, type UnsubscribeProfile,
} from '../../supabase/functions/unsubscribe/handler.ts'

const TOKEN = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const OTHER = '9c858901-8a57-4791-81fe-4c455b099bc9'

/** Records every call so a test can assert that nothing was written. */
function fakeDb(profile: UnsubscribeProfile | null = { email: 'rider@example.com', notifs_enabled: true }) {
  const calls: string[] = []
  const db: UnsubscribeDb = {
    async findByToken(token) { calls.push(`find:${token}`); return profile },
    async disable(token)     { calls.push(`disable:${token}`) },
  }
  return { db, calls, disabled: () => calls.filter(c => c.startsWith('disable:')) }
}

const get  = (t: string) => new Request(`https://fn.test/unsubscribe?t=${t}`)
const post = (t: string, body?: string) => {
  const form = new FormData()
  form.set('t', body ?? t)
  return new Request(`https://fn.test/unsubscribe?t=${t}`, { method: 'POST', body: form })
}

describe('GET is side-effect free', () => {
  // The reason this endpoint is a two-step flow at all: mail providers pre-fetch
  // every link in a message. If GET unsubscribed, scanners would opt people out
  // before the recipient ever opened the email.
  it('never writes when the link is merely fetched', async () => {
    const { db, disabled } = fakeDb()
    await handleUnsubscribe(get(TOKEN), db)
    expect(disabled()).toEqual([])
  })

  it('answers a confirmation page with a POST form, not a done message', async () => {
    const { db } = fakeDb()
    const res = await handleUnsubscribe(get(TOKEN), db)
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(body).toContain('method="POST"')
    expect(body).toContain('Yes, unsubscribe me')
    expect(body).not.toContain("you're unsubscribed")
  })

  it('carries the token into the form so the POST can find it', async () => {
    const { db } = fakeDb()
    const body = await (await handleUnsubscribe(get(TOKEN), db)).text()
    expect(body).toContain(`value="${TOKEN}"`)
  })

  it('tells an already-unsubscribed rider instead of offering the button again', async () => {
    const { db, disabled } = fakeDb({ email: 'rider@example.com', notifs_enabled: false })
    const body = await (await handleUnsubscribe(get(TOKEN), db)).text()
    expect(body).toContain("already unsubscribed")
    expect(body).not.toContain('method="POST"')
    expect(disabled()).toEqual([])
  })
})

describe('POST performs the opt-out', () => {
  it('disables notifications for the token', async () => {
    const { db, disabled } = fakeDb()
    const res = await handleUnsubscribe(post(TOKEN), db)
    expect(res.status).toBe(200)
    expect(disabled()).toEqual([`disable:${TOKEN}`])
  })

  it('confirms with the address that was unsubscribed', async () => {
    const { db } = fakeDb()
    const body = await (await handleUnsubscribe(post(TOKEN), db)).text()
    expect(body).toContain("you're unsubscribed")
    expect(body).toContain('rider@example.com')
  })

  it('prefers the form token over the query string', async () => {
    const { db, calls } = fakeDb()
    await handleUnsubscribe(post(TOKEN, OTHER), db)
    expect(calls).toContain(`disable:${OTHER}`)
    expect(calls).not.toContain(`disable:${TOKEN}`)
  })
})

describe('bad input', () => {
  it('rejects a malformed token without hitting the database', async () => {
    const { db, calls } = fakeDb()
    const res = await handleUnsubscribe(get('not-a-uuid'), db)
    expect(res.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('rejects a missing token', async () => {
    const { db } = fakeDb()
    const res = await handleUnsubscribe(new Request('https://fn.test/unsubscribe'), db)
    expect(res.status).toBe(400)
  })

  // An attacker must not be able to tell a real token from a fake one.
  it('answers an unknown token exactly like a malformed one', async () => {
    const unknown = await handleUnsubscribe(get(TOKEN), fakeDb(null).db)
    const malformed = await handleUnsubscribe(get('not-a-uuid'), fakeDb().db)
    expect(unknown.status).toBe(malformed.status)
    expect(await unknown.text()).toBe(await malformed.text())
  })

  it('does not unsubscribe anyone on a POST with an unknown token', async () => {
    const { db, disabled } = fakeDb(null)
    const res = await handleUnsubscribe(post(TOKEN), db)
    expect(res.status).toBe(400)
    expect(disabled()).toEqual([])
  })

  it('refuses methods other than GET and POST', async () => {
    const { db, calls } = fakeDb()
    const res = await handleUnsubscribe(
      new Request(`https://fn.test/unsubscribe?t=${TOKEN}`, { method: 'DELETE' }), db)
    expect(res.status).toBe(405)
    expect(calls).toEqual([])
  })

  it('reports a lookup failure as a server error rather than a bad link', async () => {
    const db: UnsubscribeDb = {
      async findByToken() { throw new Error('connection reset') },
      async disable() {},
    }
    expect((await handleUnsubscribe(get(TOKEN), db)).status).toBe(500)
  })

  it('does not claim success when the write fails', async () => {
    const db: UnsubscribeDb = {
      async findByToken() { return { email: 'r@e.com', notifs_enabled: true } },
      async disable() { throw new Error('write failed') },
    }
    const res = await handleUnsubscribe(post(TOKEN), db)
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain("you're unsubscribed")
  })
})

describe('response hygiene', () => {
  it('keeps the token out of referrers and search engines', async () => {
    const res = await handleUnsubscribe(get(TOKEN), fakeDb().db)
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('serves HTML, since a person reads this in a browser', async () => {
    const res = await handleUnsubscribe(get(TOKEN), fakeDb().db)
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })

  it('escapes the email address rather than injecting it raw', async () => {
    const { db } = fakeDb({ email: '<img src=x onerror=1>@e.com', notifs_enabled: true })
    const body = await (await handleUnsubscribe(get(TOKEN), db)).text()
    expect(body).not.toContain('<img')
    expect(body).toContain('&lt;img')
  })
})
