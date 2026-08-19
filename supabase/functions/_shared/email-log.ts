// Records one row in email_log per email actually handed to the Make webhook.
//
// Two rules shape this module:
//
//   1. Logging must never break a send. Every failure is swallowed and reported
//      through the return value, because an email that went out but wasn't
//      logged is a much smaller problem than an email that didn't go out
//      because the logging threw.
//   2. Call it only *after* the webhook accepts. A row here means "we handed
//      this to Make", which is the strongest claim this codebase can make —
//      the webhook answers as soon as it receives the payload, before the
//      scenario runs, so it is not proof of delivery to an inbox.

export interface EmailLogRow {
  /** Recipient. Stored lowercased so lookups from the app always match. */
  email: string
  /** Mirrors the payload's notification_type: 'digest', 'whats_new', … */
  kind: string
  /** Set for one-off blasts so they can be counted separately; null otherwise. */
  campaign?: string | null
  /** Anything worth showing next to the row later: spot name, session date, … */
  meta?: Record<string, unknown> | null
}

/** The slice of the Supabase client this needs, so tests can pass a fake. */
export interface EmailLogClient {
  from(table: string): {
    insert(rows: unknown): Promise<{ error: { message: string } | null }>
  }
}

export const EMAIL_LOG_TABLE = 'email_log'

/**
 * Returns true when the row was written. Never throws.
 *
 * Callers are expected to ignore the result in normal operation — it exists so
 * a batch sender can count how many rows it failed to record and report that
 * alongside its send count, rather than reporting a clean run.
 */
export async function logEmail(sb: EmailLogClient, row: EmailLogRow): Promise<boolean> {
  const email = String(row?.email ?? '').trim().toLowerCase()
  const kind  = String(row?.kind ?? '').trim()

  // A row with no recipient or no kind is unqueryable noise; refuse it here
  // rather than letting a NOT NULL violation surface as a scary error later.
  if (!email || !kind) {
    console.error('[email-log] refusing to log a row with no email or kind', { email, kind })
    return false
  }

  const record: Record<string, unknown> = { email, kind }
  // Leave the columns absent rather than explicitly null so the table defaults apply.
  if (row.campaign != null) record.campaign = row.campaign
  if (row.meta     != null) record.meta     = row.meta

  try {
    const { error } = await sb.from(EMAIL_LOG_TABLE).insert(record)
    if (error) {
      console.error(`[email-log] failed to record ${kind} to ${email}:`, error.message)
      return false
    }
    return true
  } catch (e) {
    console.error(`[email-log] threw while recording ${kind} to ${email}:`, e)
    return false
  }
}

/**
 * Batch form for senders that fan out to many riders in one run. Same
 * never-throws contract; returns how many rows were written.
 */
export async function logEmails(sb: EmailLogClient, rows: EmailLogRow[]): Promise<number> {
  const records = (rows ?? [])
    .map(r => {
      const email = String(r?.email ?? '').trim().toLowerCase()
      const kind  = String(r?.kind ?? '').trim()
      if (!email || !kind) return null
      const rec: Record<string, unknown> = { email, kind }
      if (r.campaign != null) rec.campaign = r.campaign
      if (r.meta     != null) rec.meta     = r.meta
      return rec
    })
    .filter(Boolean)

  if (records.length === 0) return 0

  try {
    const { error } = await sb.from(EMAIL_LOG_TABLE).insert(records)
    if (error) {
      console.error(`[email-log] failed to record ${records.length} rows:`, error.message)
      return 0
    }
    return records.length
  } catch (e) {
    console.error('[email-log] threw while recording a batch:', e)
    return 0
  }
}
