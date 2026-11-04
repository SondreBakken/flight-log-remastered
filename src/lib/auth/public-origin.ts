// The app runs behind Railway's TLS proxy, so request.url carries the internal origin, not the one
// visitors use. Every redirect and origin comparison reads the configured public origin instead.
export function getPublicOrigin(): string {
  const publicUrl = process.env.BETTER_AUTH_URL
  if (!publicUrl) throw new Error('Auth is not configured: BETTER_AUTH_URL must be set.')
  return new URL(publicUrl).origin
}
