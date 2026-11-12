// flightlog.org's `l=` language parameter — this app only ever requests English. Declared once
// here (config.ts re-exports it) rather than in each fetcher that builds a request URL, so the
// copies can't drift apart. No 'server-only' so the backfill script (plain Node) can import it.
export const ENGLISH = 1
