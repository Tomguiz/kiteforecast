// Caller gate for operator-only functions.
//
// Supabase's verify_jwt setting proves only that the caller holds *a* valid JWT
// signed by this project. The anon key is exactly that, and it is public — it
// ships in index.html and is pasted into tests/e2e/edge-functions.spec.ts. So
// verify_jwt alone does not stop a stranger from invoking a function; it only
// stops someone with no key at all.
//
// Functions that are triggered by an operator rather than by the app must
// therefore check for the service-role key themselves. This matters most for
// anything that mails the entire user base.

/**
 * True only when the Authorization header carries exactly the service-role key
 * as a Bearer token.
 *
 * Fails closed: an empty expected key (a misconfigured deploy, where the env var
 * is missing) rejects every caller rather than accepting every caller.
 */
export function isServiceRoleCaller(headers: Headers, serviceRoleKey: string): boolean {
  if (!serviceRoleKey) return false

  const raw = headers.get('Authorization') ?? ''
  const match = raw.match(/^\s*Bearer\s+(\S+)\s*$/i)
  if (!match) return false

  return timingSafeEqual(match[1], serviceRoleKey)
}

/**
 * Length-independent comparison. A plain === would return as soon as two bytes
 * differ; over a network the difference is almost certainly unmeasurable, but
 * the cost of not leaking it is four lines.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
