import { connection } from 'next/server'

// The hosting platform's deploy health check. It touches neither flightlog.org nor the database,
// so a WAF block or a database outage can't fail a deploy. connection() keeps Cache
// Components from prerendering it: a build-time static file would answer 200 without
// proving the server is up.
export async function GET(): Promise<Response> {
  await connection()
  return Response.json({ status: 'ok' })
}
