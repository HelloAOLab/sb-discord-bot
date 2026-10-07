/**
 * An error whose message is safe and helpful to show the user, e.g. "I couldn't find a book
 * called 'Jhon'". The router and deferred replies show its message privately instead of the
 * generic "Something went wrong" reply, and don't log it as a server error.
 */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}
