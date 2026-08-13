// Thrown only for an actual follows-table query failure (getFollowedPilotIds/
// getFollowersForPilot) — see either function's own doc comment for why that's distinguished
// from an empty result (#155). A distinct class, not a plain Error, so
// resolve-viewer-follow-state.ts's catch can single out this failure specifically and let any
// other kind of throw (e.g. a mapping bug elsewhere in the try block) propagate instead of being
// misread as "follows unavailable".
export class FollowsQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FollowsQueryError'
  }
}
