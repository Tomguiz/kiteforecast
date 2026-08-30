import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')

// This file had drifted completely away from the live database: it declared 33
// policies that no longer existed — the original `all_*` set, most of them
// `USING (true)` — and was missing all 43 that actually enforce access. Only
// two names matched.
//
// That was not cosmetic. Replaying it would have re-opened profiles,
// favourites, reminders, spot_claims and the suggestion tables to `anon`, and
// dropped the friendship-scoped rule on session_attendances. Nothing caught it,
// because nothing compared the two.

// Tables holding one rider's data. A blanket read on any of these is a leak.
const PERSONAL = [
  'profiles', 'reminders', 'favourites', 'email_log',
  'session_attendances', 'friendships', 'spot_claims',
  'spot_suggestions', 'spot_update_suggestions',
]

function policiesFor(table: string) {
  const re = new RegExp(
    `CREATE POLICY "([^"]+)" ON ${table}\\s*\\n?\\s*FOR (\\w+) TO ([^\\n]+)\\n?\\s*(USING \\(([\\s\\S]*?)\\))?\\s*(WITH CHECK \\(([\\s\\S]*?)\\))?;`,
    'g')
  const out: { name: string; cmd: string; roles: string; using: string }[] = []
  for (const m of schema.matchAll(re)) {
    out.push({ name: m[1], cmd: m[2], roles: m[3].trim(), using: (m[5] ?? '').trim() })
  }
  return out
}

describe('personal tables are never world-readable', () => {
  for (const table of PERSONAL) {
    it(`${table} has no blanket SELECT`, () => {
      const selects = policiesFor(table).filter(p => p.cmd === 'SELECT')
      expect(selects.length, `${table} has no SELECT policy declared at all`).toBeGreaterThan(0)
      for (const p of selects) {
        // `USING (true)` is the exact shape that was there before.
        expect(p.using, `${table}.${p.name} is USING (true)`).not.toBe('true')
        // and it must actually mention the caller
        expect(p.using, `${table}.${p.name} does not scope to the caller`)
          .toMatch(/auth_email\(\)|is_admin\(\)/)
      }
    })
  }
})

describe('the superseded permission model is gone', () => {
  it('no `all_*` policy names survive', () => {
    // These were the old, permissive set. Their presence means the file has
    // been rolled back to the pre-hardening model.
    const stale = [...schema.matchAll(/CREATE POLICY "(all_[a-z_]*)"/g)].map(m => m[1])
    // email_deals is genuinely public (shop ads shown in the digest).
    expect(stale.filter(n => n !== 'all_select_email_deals')).toEqual([])
  })

  it('every personal table has RLS switched on', () => {
    for (const table of PERSONAL) {
      expect(schema, `${table} never enables RLS`)
        .toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`)
    }
  })
})

describe('the file stays replayable', () => {
  it('every policy sits in an idempotent guard', () => {
    // Re-running schema.sql must not fail on an existing policy.
    const created = (schema.match(/CREATE POLICY/g) || []).length
    const guards = (schema.match(/EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;/g) || []).length
    expect(created).toBeGreaterThan(40)
    expect(guards).toBeGreaterThanOrEqual(created)
  })

  it('declares no policy twice', () => {
    const names = [...schema.matchAll(/CREATE POLICY "([^"]+)" ON (\w+)/g)].map(m => `${m[1]}|${m[2]}`)
    expect(names.length).toBe(new Set(names).size)
  })
})
