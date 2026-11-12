/**
 * What this project needs from wherever it runs.
 *
 * One declaration per resource, and this is the only place they are declared.
 * The backend reads them, `rebase resources --write` records them in
 * `rebase.resources.json` for a host to read before it runs anything, and the
 * frontend can be handed the same list with `declaredStorageSources()`.
 *
 * A database is implicit: a backend has one whether or not this file says so,
 * bound from DATABASE_URL. Name a second one to get a second.
 */
import { bucket, database } from "@rebasepro/types";

/** The project's database. Bound from DATABASE_URL. */
export const main = database();

/**
 * The default bucket, bound from the plain unsuffixed storage variables
 * (`S3_BUCKET`, `GCS_BUCKET`).
 *
 * Name more of them to get more — `bucket("media")` reads `S3_BUCKET__MEDIA`,
 * and so on for every variable that kind uses.
 */
export const files = bucket();
