// Thrown only for an actual comments-table query failure (getComments/getCommentsForTripIds) —
// see either function's own doc comment for why that's distinguished from an empty result
// (#159, following the same shape follows/follows-query-error.ts established for #155). A
// distinct class, not a plain Error, so a caller's catch can single out this failure
// specifically and let any other kind of throw (e.g. a mapping bug elsewhere in the same async
// function) propagate instead of being misread as "no comments".
export class CommentsQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommentsQueryError'
  }
}
