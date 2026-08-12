import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// A minimal stand-in for Supabase's own chainable, thenable PostgrestFilterBuilder. Shared by
// every *.test.ts under src/lib/comments and src/lib/follows that needs one — nothing about the
// builder itself is domain-specific, so one copy here stands in for both callers instead of a
// separate copy living alongside each.
// Lives here rather than alongside its callers under src/lib/comments or src/lib/follows: it
// imports vitest, so a product-code directory is the wrong home for it even without a .test.
// suffix to exclude it by name — every *.ts(x) under src is still part of tsconfig's own include.
//
// Every filter method returns the same builder so a `.select().eq().order()`,
// `.select().in().order()`, or any other chain shape the code under test calls resolves however
// it's built, and the builder itself resolves (via `then`) to the given result — same shape
// `await supabase.from(...).select(...)` resolves to for real.
function createQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  }
  return builder
}

export function fakeSupabaseQuery(result: { data: unknown; error: unknown }) {
  const builder = createQueryBuilder(result)
  const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient
  return { client, builder }
}
