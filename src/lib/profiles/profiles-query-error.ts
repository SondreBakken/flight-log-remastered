// Thrown only for an actual profiles-table query failure (getDisplayNames) that is NOT the
// known-transitional 42703 (undefined_column) case — see that function's own doc comment for why
// a missing column stays a soft degrade instead of throwing this. A distinct class, not a plain
// Error, mirroring follows/follows-query-error.ts and comments/comments-query-error.ts (#155,
// #159), so a caller's catch can single out this failure specifically and let any other kind of
// throw (e.g. a mapping bug elsewhere in the same async function) propagate instead of being
// misread as "profiles unavailable".
export class ProfilesQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProfilesQueryError'
  }
}
