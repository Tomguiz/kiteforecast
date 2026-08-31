import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const app = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

// public_profiles is a simple auto-updatable view over profiles, owned by
// postgres and deliberately WITHOUT security_invoker — profiles is own-row
// under RLS, so an invoker-rights view could never find anybody else, which is
// the whole job of a friend search.
//
// That makes the GRANT the only thing standing between a signed-in rider and
// everybody else's profile row. Supabase's default privileges had handed
// `authenticated` INSERT/UPDATE/DELETE/TRUNCATE on it, so any rider could have
// rewritten another's nickname, deleted their row, or set is_premium on their
// own. Revoked in production; pinned here so it cannot come back unnoticed.

describe('public_profiles is readable, never writable', () => {
  it('the schema revokes everything before granting', () => {
    expect(schema).toMatch(/REVOKE ALL ON public_profiles FROM anon, authenticated;/)
    expect(schema).toMatch(/GRANT SELECT ON public_profiles TO authenticated;/)
  })

  it('grants no write privilege to authenticated', () => {
    const grants = [...schema.matchAll(/GRANT ([A-Z, ]+) ON public_profiles TO ([a-z, ]+);/g)]
    expect(grants.length).toBeGreaterThan(0)
    for (const g of grants) {
      const privs = g[1].split(',').map(s => s.trim())
      for (const p of privs) {
        expect(['SELECT'], `granted ${p} on public_profiles`).toContain(p)
      }
    }
  })

  it('exposes no sensitive column', () => {
    const m = schema.match(/CREATE OR REPLACE VIEW public_profiles AS\s*\n\s*SELECT ([^;]+) FROM profiles;/)
    expect(m).toBeTruthy()
    const cols = m![1].split(',').map(c => c.trim())
    expect(cols.sort()).toEqual(['email', 'first_name', 'is_premium', 'last_name', 'nickname'])
    // the columns that must never reach it
    for (const bad of ['phone_number', 'stripe_customer_id', 'stripe_subscription_id', 'unsubscribe_token']) {
      expect(cols, `${bad} exposed`).not.toContain(bad)
    }
  })

  it('the app only ever reads it', () => {
    // A write path in the client would be the thing that makes the grant matter
    // again. There is none, and there should not be.
    const uses = [...app.matchAll(/from\('public_profiles'\)\.(\w+)/g)].map(m => m[1])
    expect(uses.length).toBeGreaterThan(0)
    expect([...new Set(uses)]).toEqual(['select'])
  })
})

describe('real names', () => {
  it('the columns are declared', () => {
    expect(schema).toContain('ADD COLUMN IF NOT EXISTS first_name text')
    expect(schema).toContain('ADD COLUMN IF NOT EXISTS last_name  text')
  })

  it('the friend search looks at them, not only the nickname', () => {
    expect(app).toMatch(/nickname\.ilike[\s\S]{0,80}first_name\.ilike[\s\S]{0,80}last_name\.ilike/)
  })

  it('strips the characters that would break an or() filter', () => {
    // A comma is the separator inside or(); a raw one would build a malformed
    // filter rather than searching for it.
    expect(app).toMatch(/query\.replace\(\/\[,%\*\(\)\]\/g/)
  })
})
