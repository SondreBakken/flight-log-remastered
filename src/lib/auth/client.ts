'use client'

import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'

// No baseURL: the browser calls /api/auth on whatever origin served the page.
export const authClient = createAuthClient({ plugins: [magicLinkClient()] })
