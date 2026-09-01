/**
 * Milestone 1 shipped with no authentication, and Milestone 3A does not
 * add real authentication either — that's a deliberate scope decision
 * (see the Milestone 3A report). But every persisted record (tasks,
 * activity) is written with a user_id from day one, so real auth can be
 * dropped in later without a schema change: swap `LOCAL_USER_ID` for the
 * authenticated user's id wherever it's used.
 */
export const LOCAL_USER_ID = "local-owner";
