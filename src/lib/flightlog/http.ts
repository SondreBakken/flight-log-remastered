import 'server-only'

// The fetch core lives in http-core.ts without the server-only guard so the backfill script
// (a plain Node process, no Next) can share it; every app loader keeps importing from here.
export * from './http-core'
