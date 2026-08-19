// Token-based email opt-out, reachable without signing in.
//
// All request handling lives in handler.ts behind a small database port; this
// file only wires Supabase into it and serves. See handler.ts for why GET is
// deliberately side-effect free.
//
// Deployed with verify_jwt = false (see supabase/config.toml): a link clicked in
// an email carries no Authorization header, and every other function in this
// project answers 401 without one. The only credential this endpoint accepts is
// the unguessable per-profile unsubscribe_token.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleUnsubscribe, type UnsubscribeDb } from './handler.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const db: UnsubscribeDb = {
  async findByToken(token) {
    const { data, error } = await supabase
      .from('profiles').select('email,notifs_enabled')
      .eq('unsubscribe_token', token).maybeSingle()
    if (error) throw new Error(error.message)
    return data ?? null
  },
  async disable(token) {
    const { error } = await supabase
      .from('profiles').update({ notifs_enabled: false })
      .eq('unsubscribe_token', token)
    if (error) throw new Error(error.message)
  },
}

Deno.serve(req => handleUnsubscribe(req, db))
