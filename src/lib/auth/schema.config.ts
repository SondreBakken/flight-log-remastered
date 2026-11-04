// Read only by the Better Auth CLI (`pnpm db:auth-schema`). The CLI cannot load server.ts, which
// imports 'server-only' and needs DATABASE_URL, so this builds an instance from the same options.
import { betterAuth } from 'better-auth'
import { authOptions } from './options'

export const auth = betterAuth(authOptions)
