import { connection } from 'next/server'
import { readUpstreamStatus } from '@/lib/flightlog/upstream-status-store'

// Reports what recent gated requests saw of flightlog.org. It reads the in-memory window only
// and never calls flightlog.org itself. connection() keeps Cache Components from prerendering
// it: a build-time file would freeze the state at build.
export async function GET(): Promise<Response> {
  await connection()
  return Response.json(readUpstreamStatus(Date.now()), { headers: { 'Cache-Control': 'no-store' } })
}
