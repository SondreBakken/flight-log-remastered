import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// A minimal stand-in for Supabase's own chainable, thenable PostgrestFilterBuilder, shared by
// get-followed-pilot-ids.test.ts and get-followers-for-pilot.test.ts (they previously each
// defined a byte-identical copy). Lives here rather than alongside them under src/lib/follows/
// (same reasoning as this directory's own hydrate.tsx): it imports vitest, so a product-code
// directory is the wrong home for it even without a .test. suffix to exclude it by name — every
// *.ts(x) under src is still part of tsconfig's own include.
//
// Every filter method returns the same builder so a `.select().eq().in().order()` chain
// resolves however the code under test calls it, and the builder itself resolves (via `then`) to
// the given result — same shape `await supabase.from(...).select(...)` resolves to for real.
// Exposes all three filter methods (eq/in/order) so either test file's own chain shape is
// covered without needing its own copy.
function createFollowsQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  }
  return builder
}

export function fakeFollowsSupabase(result: { data: unknown; error: unknown }) {
  const builder = createFollowsQueryBuilder(result)
  const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient
  return { client, builder }
}
