import type { SupabaseClient } from '@supabase/supabase-js'

// Shared by verify-feed.mts and verify-follows-select-policy.mts: both read from the `follows`
// table before doing anything else and need the exact same fail-fast guard against a
// not-yet-applied migration, so every assertion downstream isn't left to fail confusingly
// against a client that was never actually able to reach the table — see
// src/lib/follows/get-followed-pilot-ids.ts for the same table read at runtime by the app itself.
//
// Fails on ANY error, not just 42P01 (undefined_table) — an invalid service-role key or a
// network failure would otherwise pass this guard silently and only surface as a confusing
// failure several steps later. 42P01 gets its own named message because it maps to a specific,
// actionable fix (apply the migration); every other error gets its code and message surfaced
// as-is instead of being swallowed.
export async function checkFollowsTableExists(adminClient: SupabaseClient): Promise<void> {
  const { error } = await adminClient.from('follows').select('user_id').limit(1)
  if (!error) return

  if (error.code === '42P01') {
    console.error('the `follows` table does not exist in this Supabase project — apply supabase/migrations before running this script.')
  } else {
    console.error(`precondition check failed querying \`follows\`: [${error.code ?? 'no code'}] ${error.message}`)
  }
  process.exit(1)
}
