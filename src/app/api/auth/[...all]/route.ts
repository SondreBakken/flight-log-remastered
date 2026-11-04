import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth/server'

// A function rather than the instance: the instance needs DATABASE_URL, which `next build` lacks.
export const { GET, POST } = toNextJsHandler((request: Request) => getAuth().handler(request))
