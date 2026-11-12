import type { DefaultRls } from "@rebasepro/server/schema";

/**
 * Every table this backend serves. A `defineTable` that is not exported from
 * here is refused at boot and by `rebase db generate`.
 */
export { posts } from "./posts";
export { authors } from "./authors";
export { tags } from "./tags";
export { users } from "./users";

/**
 * What a table with `rls: "inherit"` gets: every caller reads every row, only
 * admins write.
 *
 * `access: "public"` is about ROWS, not about who may call the API — it means
 * "no row filter", not "no login". A request with no token is still answered
 * 401 by the API before row-level security is ever consulted. To serve readers
 * who are not signed in (a public website reading this backend), set
 * `AUTH_REQUIRE=false` in the backend's environment; access then rests entirely
 * on these rules, which is what they are for.
 *
 * These live beside the tables because `rebase db push` and boot generate the
 * Postgres policies from them — that is what actually enforces access.
 */
export const defaultRls: DefaultRls = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];
