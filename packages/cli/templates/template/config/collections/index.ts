import postsCollection from "./posts";
import authorsCollection from "./authors";
import tagsCollection from "./tags";
import usersCollection from "./users";
import type { SecurityRule } from "@rebasepro/types";

/**
 * Applied to any collection in this directory that declares no
 * `securityRules` of its own: every signed-in user reads every row, only
 * admins write.
 *
 * `access: "public"` is about ROWS, not about who may call the API — it means
 * "no row filter", not "no login". A request with no token is still answered
 * 401 by the API before RLS is ever consulted. To serve readers who are not
 * signed in (a public website reading this backend), set `AUTH_REQUIRE=false`
 * in the backend's environment; access then rests entirely on these rules,
 * which is what they are for.
 *
 * These live here, next to the collections, because `rebase db push`
 * generates the Postgres policies from these files — that is what actually
 * enforces access. A default declared on the server could never reach the
 * database.
 *
 * A collection that declares neither its own rules nor inherits these is
 * locked by default: admin-only.
 */
export const defaultSecurityRules: SecurityRule[] = [
    { operation: "select",
access: "public" },
    { operations: ["insert", "update", "delete"],
roles: ["admin"] }
];

export const collections = [postsCollection, authorsCollection, tagsCollection, usersCollection];

// What `rebase dev`, `rebase db push` and the admin panel do when they read this
// directory, done here as well: a collection with no `securityRules` of its own
// gets `defaultSecurityRules`, on the collection object itself, so a relation's
// target carries them too. So this array is safe to hand to a backend of your
// own — `createRebaseBackend({ collections })` provisions the policies
// `db push` would — rather than a version of these collections that is admin-only.
for (const collection of collections) {
    if (!collection.securityRules?.length) collection.securityRules = defaultSecurityRules;
}
