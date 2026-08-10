import type { SupabaseClient } from '@supabase/supabase-js'

// Spec's own rate limit (docs/superpowers/specs/2026-08-10-social-features-design.md's
// Comments section): 5 or more comments already posted in the trailing minute rejects the
// insert. A plain count(*) query against `comments`, no external rate-limiting provider.
const RATE_LIMIT_WINDOW_MINUTES = 1
const RATE_LIMIT_MAX_COMMENTS = 5

export type PostCommentInput = {
  tripId: number
  userId: string
  body: string
}

export type PostCommentResult =
  | { kind: 'posted' }
  | { kind: 'empty-body' }
  | { kind: 'rate-limited' }
  | { kind: 'db-error'; message: string }

function isBlank(body: string): boolean {
  return body.trim().length === 0
}

async function countRecentComments(supabase: SupabaseClient, userId: string): Promise<number | null> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString()

  const { count, error } = await supabase
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gt('created_at', since)

  if (error) {
    console.error('[comments] failed to check the comment rate limit:', error)
    return null
  }

  return count ?? 0
}

// Business logic: rate-limit then insert, against an injected Supabase client so this is
// testable without a live database (see scripts/check-comments.mts) — which client, cookies,
// and "who is the caller" are the infra caller's job (src/features/comment-on-flight/actions.ts),
// not this function's.
export async function postComment(supabase: SupabaseClient, input: PostCommentInput): Promise<PostCommentResult> {
  if (isBlank(input.body)) return { kind: 'empty-body' }

  const recentCount = await countRecentComments(supabase, input.userId)
  if (recentCount === null) return { kind: 'db-error', message: 'failed to check the rate limit' }
  if (recentCount >= RATE_LIMIT_MAX_COMMENTS) return { kind: 'rate-limited' }

  const { error } = await supabase
    .from('comments')
    .insert({ trip_id: input.tripId, user_id: input.userId, body: input.body.trim() })

  if (error) {
    console.error('[comments] failed to insert comment:', error)
    return { kind: 'db-error', message: 'failed to save the comment' }
  }

  return { kind: 'posted' }
}
