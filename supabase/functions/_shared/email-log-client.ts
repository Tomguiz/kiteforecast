// Auto-wired convenience layer over email-log.ts.
//
// email-log.ts stays free of any Supabase import so it can be unit tested under
// vitest; this file is the Deno-only half that builds the client from the
// environment. Senders import from here so adding logging to a function is one
// import and one call, rather than createClient boilerplate in ten files.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logEmail, logEmails, type EmailLogClient, type EmailLogRow } from './email-log.ts'

export type { EmailLogRow } from './email-log.ts'

let cached: EmailLogClient | null = null

function client(): EmailLogClient | null {
  if (cached) return cached
  const url = Deno.env.get('SUPABASE_URL')
  // The service key is spelled SB_SERVICE_ROLE_KEY in most functions but
  // SERVICE_ROLE_KEY in friend-request-notify and session-attend-notify. Accept
  // either rather than making the logging silently no-op in two functions.
  const key = Deno.env.get('SB_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
  if (!url || !key) {
    console.error('[email-log] no SUPABASE_URL / service key in env — not logging')
    return null
  }
  cached = createClient(url, key) as unknown as EmailLogClient
  return cached
}

/** Record one sent email. Never throws; returns false if it could not record. */
export async function recordEmail(row: EmailLogRow): Promise<boolean> {
  const sb = client()
  if (!sb) return false
  return logEmail(sb, row)
}

/** Record a batch in a single insert. Never throws; returns rows written. */
export async function recordEmails(rows: EmailLogRow[]): Promise<number> {
  const sb = client()
  if (!sb) return 0
  return logEmails(sb, rows)
}
