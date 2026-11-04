// Read only by the Better Auth CLI (`pnpm db:auth-schema`) to generate auth-schema.ts.
// The real auth instance arrives with the auth routes; app code must not import this file.
import { betterAuth } from 'better-auth'

export const auth = betterAuth({})
