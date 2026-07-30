import postsCollection from "./posts.js";
import authorsCollection from "./authors.js";
import tagsCollection from "./tags.js";
import usersCollection from "./users.js";
import type { SecurityRule } from "@rebasepro/types";

export const collections = [postsCollection, authorsCollection, tagsCollection, usersCollection];

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
