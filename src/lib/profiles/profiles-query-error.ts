// Thrown only for an actual profiles query failure, as a distinct class (mirroring
// FollowsQueryError and CommentsQueryError) so a caller's catch can single it out and let any
// other throw, e.g. a mapping bug, propagate instead of being misread as "profiles unavailable".
export class ProfilesQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProfilesQueryError'
  }
}
