import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// A route handler, not a server action — this repo has no server actions yet, and its one
// precedent for the choice (api/pilots/[userId]/recent-flights/route.ts) already established
// route handlers as the convention here for a POST-and-redirect flow.
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  await supabase.auth.signOut()

  return NextResponse.redirect(new URL('/', request.url), { status: 303 })
}
