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
const post = (t: string, bodyToken?: string) =>
  new Request(`https://fn.test/unsubscribe?t=${t}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ t: bodyToken ?? t }),
  })

describe('GET is side-effect free', () => {
  // The reason this is a two-step flow at all: mail providers pre-fetch every
  // link in a message. If GET unsubscribed, scanners would opt people out before
  // the recipient ever opened the email.
  it('never writes when the link is merely fetched', async () => {
    const { db, disabled } = fakeDb()
    await handleUnsubscribe(get(TOKEN), db)
    expect(disabled()).toEqual([])
  })

  it('returns the address so the page can name it, and nothing more', async () => {
    const { db } = fakeDb()
    const res = await handleUnsubscribe(get(TOKEN), db)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'rider@example.com', already_unsubscribed: false })
  })

  it('flags an already-unsubscribed rider without writing again', async () => {
    const { db, disabled } = fakeDb({ email: 'rider@example.com', notifs_enabled: false })
    const body = await (await handleUnsubscribe(get(TOKEN), db)).json()
    expect(body.already_unsubscribed).toBe(true)
    expect(disabled()).toEqual([])
  })
})

describe('POST performs the opt-out', () => {
  it('disables notifications for the token', async () => {
    const { db, disabled } = fakeDb()
    const res = await handleUnsubscribe(post(TOKEN), db)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, email: 'rider@example.com' })
    expect(disabled()).toEqual([`disable:${TOKEN}`])
  })

  it('prefers the body token over the query string', async () => {
    const { db, calls } = fakeDb()
    await handleUnsubscribe(post(TOKEN, OTHER), db)
    expect(calls).toContain(`disable:${OTHER}`)
    expect(calls).not.toContain(`disable:${TOKEN}`)
  })

  it('still works when the request carries no body at all', async () => {
    const { db, disabled } = fakeDb()
    const res = await handleUnsubscribe(
      new Request(`https://fn.test/unsubscribe?t=${TOKEN}`, { method: 'POST' }), db)
    expect(res.status).toBe(200)
    expect(disabled()).toEqual([`disable:${TOKEN}`])
  })
})

describe('the browser can actually call this', () => {
  // The page is on GitHub Pages and the function on supabase.co, so every call
  // is cross-origin. Without these the fetch fails before it starts.
  it('answers the preflight', async () => {
    const res = await handleUnsubscribe(
      new Request(`https://fn.test/unsubscribe?t=${TOKEN}`, { method: 'OPTIONS' }), fakeDb().db)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('sends CORS headers on the real responses too', async () => {
    for (const res of [
      await handleUnsubscribe(get(TOKEN), fakeDb().db),
      await handleUnsubscribe(post(TOKEN), fakeDb().db),
      await handleUnsubscribe(get('nope'), fakeDb().db),
    ]) {
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    }
  })

  // Supabase rewrites text/html to text/plain on this domain, which is why the
  // page moved to GitHub Pages. Returning JSON is the whole point.
  it('returns JSON, never HTML', async () => {
    const res = await handleUnsubscribe(get(TOKEN), fakeDb().db)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await res.text()).not.toContain('<html')
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
    const res = await handleUnsubscribe(new Request('https://fn.test/unsubscribe'), fakeDb().db)
    expect(res.status).toBe(400)
  })

  // An attacker must not be able to tell a real token from a fake one.
  it('answers an unknown token exactly like a malformed one', async () => {
    const unknown   = await handleUnsubscribe(get(TOKEN), fakeDb(null).db)
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

  it('refuses methods other than GET, POST and OPTIONS', async () => {
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
    expect((await res.json()).ok).toBeUndefined()
  })
})

describe('response hygiene', () => {
  it('keeps the token out of referrers and search engines', async () => {
    const res = await handleUnsubscribe(get(TOKEN), fakeDb().db)
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
