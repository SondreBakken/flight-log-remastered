import type { SupabaseClient } from '@supabase/supabase-js'
import type { Comment } from './types'

type CommentRow = {
  id: string
  user_id: string
  body: string
  created_at: string
}

function toComment(row: CommentRow): Comment {
  return { id: row.id, userId: row.user_id, body: row.body, createdAt: row.created_at }
}

// Public read: works for a signed-out visitor exactly as well as a signed-in one, since both
// go through the same anon-key client and the same RLS policy (`deleted_at is null`, see
// supabase/migrations/20260810000000_create_comments.sql) — no special case here for an
// author's own deleted comment, matching that policy's own "everyone" scope. Oldest first, so
// a newly posted comment appends to the bottom of the thread rather than jumping to the top.
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

  return (data as CommentRow[]).map(toComment)
}
