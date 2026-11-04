import type { Database } from '@/lib/db/client'
import { getComments } from './get-comments'
import { CommentsQueryError } from './comments-query-error'
import type { Comment } from './types'

export type CommentsForFlight = { status: 'loaded'; comments: Comment[] } | { status: 'comments-unavailable' }

// Comments are additive to the flight page, so a failed comments query degrades to an inline
// "couldn't load" notice. Only CommentsQueryError is caught: any other throw is a bug, and it
// propagates to the app-root error boundary rather than being disguised as a load failure.
export async function loadCommentsForFlight(db: Database, tripId: number): Promise<CommentsForFlight> {
  try {
    return { status: 'loaded', comments: await getComments(db, tripId) }
  } catch (error) {
    if (!(error instanceof CommentsQueryError)) throw error
    console.error('[comments] failed to load comments for flight:', error)
    return { status: 'comments-unavailable' }
  }
}
