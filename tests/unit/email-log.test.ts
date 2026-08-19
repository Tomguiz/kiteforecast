import { describe, it, expect } from 'vitest'
import {
  logEmail, logEmails, EMAIL_LOG_TABLE, type EmailLogClient,
} from '../../supabase/functions/_shared/email-log.ts'

/** Captures inserts; optionally fails, so the never-throws contract is testable. */
function fakeClient(opts: { error?: string; throws?: boolean } = {}) {
  const inserts: { table: string; rows: any }[] = []
  const sb: EmailLogClient = {
    from(table) {
      return {
        async insert(rows) {
          if (opts.throws) throw new Error('connection reset')
          inserts.push({ table, rows })
          return { error: opts.error ? { message: opts.error } : null }
        },
      }
    },
  }
  return { sb, inserts, rows: () => inserts.flatMap(i => Array.isArray(i.rows) ? i.rows : [i.rows]) }
}

describe('logEmail', () => {
  it('writes one row to email_log', async () => {
    const { sb, inserts, rows } = fakeClient()
    expect(await logEmail(sb, { email: 'rider@example.com', kind: 'digest' })).toBe(true)
    expect(inserts[0].table).toBe(EMAIL_LOG_TABLE)
    expect(rows()[0]).toEqual({ email: 'rider@example.com', kind: 'digest' })
  })

  // The app looks riders up by the address on their profile; a stray capital
  // would silently hide their history.
  it('normalises the address', async () => {
    const { sb, rows } = fakeClient()
    await logEmail(sb, { email: '  Rider@Example.COM  ', kind: 'digest' })
    expect(rows()[0].email).toBe('rider@example.com')
  })

  it('carries campaign and meta when given', async () => {
    const { sb, rows } = fakeClient()
    await logEmail(sb, {
      email: 'r@e.com', kind: 'whats_new',
      campaign: 'whats-new-2026-08', meta: { tier: 'lifetime' },
    })
    expect(rows()[0]).toEqual({
      email: 'r@e.com', kind: 'whats_new',
      campaign: 'whats-new-2026-08', meta: { tier: 'lifetime' },
    })
  })

  it('omits campaign and meta entirely when absent, so table defaults apply', async () => {
    const { sb, rows } = fakeClient()
    await logEmail(sb, { email: 'r@e.com', kind: 'digest' })
    expect(Object.keys(rows()[0]).sort()).toEqual(['email', 'kind'])
  })

  it('refuses a row with no recipient, without touching the database', async () => {
    const { sb, inserts } = fakeClient()
    expect(await logEmail(sb, { email: '   ', kind: 'digest' })).toBe(false)
    expect(inserts).toEqual([])
  })

  it('refuses a row with no kind', async () => {
    const { sb, inserts } = fakeClient()
    expect(await logEmail(sb, { email: 'r@e.com', kind: '' })).toBe(false)
    expect(inserts).toEqual([])
  })

  // Rule 1: an email that went out but wasn't logged beats an email that never
  // went out because logging blew up.
  it('reports a database error without throwing', async () => {
    const { sb } = fakeClient({ error: 'permission denied' })
    await expect(logEmail(sb, { email: 'r@e.com', kind: 'digest' })).resolves.toBe(false)
  })

  it('swallows a client that throws outright', async () => {
    const { sb } = fakeClient({ throws: true })
    await expect(logEmail(sb, { email: 'r@e.com', kind: 'digest' })).resolves.toBe(false)
  })
})

describe('logEmails', () => {
  it('writes every valid row in one insert', async () => {
    const { sb, inserts, rows } = fakeClient()
    const n = await logEmails(sb, [
      { email: 'a@e.com', kind: 'digest' },
      { email: 'b@e.com', kind: 'digest' },
    ])
    expect(n).toBe(2)
    expect(inserts).toHaveLength(1)   // one round-trip, not one per rider
    expect(rows().map(r => r.email)).toEqual(['a@e.com', 'b@e.com'])
  })

  it('drops invalid rows but still writes the good ones', async () => {
    const { sb, rows } = fakeClient()
    const n = await logEmails(sb, [
      { email: 'a@e.com', kind: 'digest' },
      { email: '', kind: 'digest' },
      { email: 'c@e.com', kind: '' },
    ])
    expect(n).toBe(1)
    expect(rows().map(r => r.email)).toEqual(['a@e.com'])
  })

  it('does not call the database for an empty batch', async () => {
    const { sb, inserts } = fakeClient()
    expect(await logEmails(sb, [])).toBe(0)
    expect(inserts).toEqual([])
  })

  it('returns 0 rather than throwing when the insert fails', async () => {
    const { sb } = fakeClient({ error: 'deadlock detected' })
    await expect(logEmails(sb, [{ email: 'a@e.com', kind: 'digest' }])).resolves.toBe(0)
  })
})
