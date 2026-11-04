import 'server-only'

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { getDb } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { authOptions } from './options'
import { getPublicOrigin } from './public-origin'

type AuthDatabase = Parameters<typeof drizzleAdapter>[0]

let auth: Auth | undefined

// Built on first call, never at import: `next build` evaluates server modules without
// DATABASE_URL or BETTER_AUTH_URL.
export function getAuth(): Auth {
  auth ??= createAuth(getDb(), getPublicOrigin())
  return auth
}

export function createAuth(database: AuthDatabase, baseURL: string) {
  return betterAuth({
    ...authOptions,
    // The base URL's origin is the only trusted origin, and an https base URL is what marks the
    // session cookie Secure.
    baseURL,
    database: drizzleAdapter(database, { provider: 'pg', schema }),
  })
}

type Auth = ReturnType<typeof createAuth>
