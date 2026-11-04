import type { BetterAuthOptions } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { magicLink } from 'better-auth/plugins/magic-link'
import { sendMagicLinkEmail } from '@/lib/email/send-magic-link-email'

// Kept free of the database and 'server-only' so the Better Auth CLI can load it to generate
// auth-schema.ts (see schema.config.ts); server.ts adds the database and the base URL.
export const authOptions = {
  plugins: [
    magicLink({ sendMagicLink: ({ email, url }) => sendMagicLinkEmail(email, url) }),
    // Must stay last: it copies cookies set by the other plugins into Next's cookie store, and
    // skips session refresh while a Server Component renders, where cookies cannot be written.
    nextCookies(),
  ],
} satisfies BetterAuthOptions
