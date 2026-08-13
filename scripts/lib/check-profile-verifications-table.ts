import type { SupabaseClient } from '@supabase/supabase-js'

// Mirrors check-follows-table.ts's fail-fast guard, for the same reason: every assertion
// downstream in verify-profile-verifications-select-policy.mts otherwise fails confusingly
// against a client that was never actually able to reach the table, instead of surfacing the
// real cause (migration 20260813000000_create_profile_verifications.sql not applied yet).
//
// Fails on ANY error, not just 42P01 (undefined_table) — a bad service-role key or a network
// failure must not pass this guard silently.
export async function checkProfileVerificationsTableExists(adminClient: SupabaseClient): Promise<void> {
  const { error } = await adminClient.from('profile_verifications').select('user_id').limit(1)
  if (!error) return

  if (error.code === '42P01') {
    console.error(
      'the `profile_verifications` table does not exist in this Supabase project — apply supabase/migrations/20260813000000_create_profile_verifications.sql before running this script.',
    )
  } else {
    console.error(`precondition check failed querying \`profile_verifications\`: [${error.code ?? 'no code'}] ${error.message}`)
  }
  process.exit(1)
}
