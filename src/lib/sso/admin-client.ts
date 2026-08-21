import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the Innova SSO bridge (see
// src/app/api/sso/route.ts). Mirrors src/lib/ai/admin-client.ts,
// src/lib/flows/admin-client.ts and src/lib/automations/admin-client.ts —
// minting a session for another user requires the service role, which the
// normal browser/server clients (anon key) can't do.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
