import 'server-only'

import { cache } from 'react'
import { headers } from 'next/headers'
import { getAuth } from './server'

// headers() is awaited before the auth instance is touched, so under Cache Components the caller
// is marked dynamic before any database access. Never call this inside 'use cache'.
// cache() lets every server-side reader in one request share a single session lookup.
export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const requestHeaders = await headers()
  const session = await getAuth().api.getSession({ headers: requestHeaders })
  return session?.user.id ?? null
})
