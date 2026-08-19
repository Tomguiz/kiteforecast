import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isServiceRoleCaller } from '../../supabase/functions/_shared/service-role-auth.ts'

// The anon key is public — it ships in index.html and is pasted into
// tests/e2e/edge-functions.spec.ts. Supabase's verify_jwt only proves the caller
// holds *a* valid project JWT, so it lets the anon key through. Any function
// that mails every registered rider therefore needs its own gate on top.
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiJ9.service-role-key-stand-in.sig'
const ANON_KEY    = 'eyJhbGciOiJIUzI1NiJ9.anon-key-stand-in.sig'

const header = (v: string | null) =>
  new Headers(v === null ? {} : { Authorization: v })

describe('isServiceRoleCaller', () => {
  it('accepts the service-role key', () => {
    expect(isServiceRoleCaller(header(`Bearer ${SERVICE_KEY}`), SERVICE_KEY)).toBe(true)
  })

  it('accepts a lowercase bearer scheme', () => {
    expect(isServiceRoleCaller(header(`bearer ${SERVICE_KEY}`), SERVICE_KEY)).toBe(true)
  })

  it('tolerates surrounding whitespace', () => {
    expect(isServiceRoleCaller(header(`Bearer   ${SERVICE_KEY}  `), SERVICE_KEY)).toBe(true)
  })

  // The whole point of the guard.
  it('rejects the public anon key', () => {
    expect(isServiceRoleCaller(header(`Bearer ${ANON_KEY}`), SERVICE_KEY)).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(isServiceRoleCaller(header(null), SERVICE_KEY)).toBe(false)
  })

  it('rejects an empty bearer token', () => {
    expect(isServiceRoleCaller(header('Bearer '), SERVICE_KEY)).toBe(false)
  })

  it('rejects a bare token with no scheme', () => {
    expect(isServiceRoleCaller(header(SERVICE_KEY), SERVICE_KEY)).toBe(false)
  })

  it('rejects a token that merely starts with the key', () => {
    expect(isServiceRoleCaller(header(`Bearer ${SERVICE_KEY}extra`), SERVICE_KEY)).toBe(false)
  })

  it('rejects a truncated key', () => {
    expect(isServiceRoleCaller(header(`Bearer ${SERVICE_KEY.slice(0, -1)}`), SERVICE_KEY)).toBe(false)
  })

  // A misconfigured deploy must fail closed, not open.
  it('rejects everything when the expected key is empty', () => {
    expect(isServiceRoleCaller(header('Bearer '), '')).toBe(false)
    expect(isServiceRoleCaller(header('Bearer anything'), '')).toBe(false)
  })
})

describe('the broadcast function actually uses the guard', () => {
  // A unit-tested guard that nobody calls protects nothing. This pins the wiring
  // so the gate can't be dropped from index.ts without a red test.
  const source = readFileSync(
    fileURLToPath(new URL('../../supabase/functions/whats-new/index.ts', import.meta.url)), 'utf8')

  it('imports the guard', () => {
    expect(source).toContain('service-role-auth.ts')
  })

  it('rejects non-service-role callers before reading any profile', () => {
    const guardAt = source.indexOf('isServiceRoleCaller')
    const queryAt = source.indexOf("from('profiles')")
    expect(guardAt).toBeGreaterThan(-1)
    expect(queryAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(queryAt)
  })

  it('answers 401 rather than silently doing nothing', () => {
    expect(source).toMatch(/Service-role key required'\s*\}\s*,\s*401/)
  })
})
