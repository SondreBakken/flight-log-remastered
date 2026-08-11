import type { SupabaseClient } from '@supabase/supabase-js'
import { getDisplayNames } from '@/lib/profiles/get-display-names'
import type { Comment } from './types'

type CommentRow = {
  id: string
  user_id: string
  body: string
  created_at: string
}

function toComment(row: CommentRow, displayNames: Map<string, string | null>): Comment {
  return {
    id: row.id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
    displayName: displayNames.get(row.user_id) ?? null,
  }
}

// Public read: works for a signed-out visitor exactly as well as a signed-in one, since both
// go through the same anon-key client and the same RLS policy (`deleted_at is null`, see
// supabase/migrations/20260810000000_create_comments.sql) — no special case here for an
// author's own deleted comment, matching that policy's own "everyone" scope. Oldest first, so
// a newly posted comment appends to the bottom of the thread rather than jumping to the top.
//
// Two queries, not one PostgREST embed: comments.user_id and profiles.user_id both FK to
// auth.users independently, with no direct FK between comments and profiles for PostgREST to
// join across in a single select. The display-name lookup is merged into each row here, in
// application code, instead.
export async function getComments(supabase: SupabaseClient, tripId: number): Promise<Comment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('id, user_id, body, created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[comments] failed to load comments:', error)
    return []
  }

  const rows = data as CommentRow[]
  const displayNames = await getDisplayNames(supabase, [...new Set(rows.map((row) => row.user_id))])

  return rows.map((row) => toComment(row, displayNames))
}
