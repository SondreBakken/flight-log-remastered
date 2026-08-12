import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// A minimal stand-in for Supabase's own chainable, thenable PostgrestFilterBuilder, shared by
// get-comments.test.ts and get-comments-for-trip-ids.test.ts — same shape (and same reasoning
// for living here rather than under src/lib/comments/) as follows-query-builder-fake.ts, which
// this mirrors rather than extends: that file's own doc comment explains why a product-code
// directory is the wrong home for a vitest-importing fake, and follows/ is out of scope for
// #159 (already shipped, see its own PR), so this stays its own copy instead of reaching into
// that directory to generalize the two into one shared fake.
//
// Every filter method returns the same builder so a `.select().eq().order()` (get-comments.ts)
// or `.select().in().order()` (get-comments-for-trip-ids.ts) chain resolves however the code
// under test calls it, and the builder itself resolves (via `then`) to the given result — same
// shape `await supabase.from(...).select(...)` resolves to for real.
function createCommentsQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  }
  return builder
}

export function fakeCommentsSupabase(result: { data: unknown; error: unknown }) {
  const builder = createCommentsQueryBuilder(result)
  const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient
  return { client, builder }
}
