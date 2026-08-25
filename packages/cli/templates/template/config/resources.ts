/**
 * What this project needs from wherever it runs.
 *
 * A resource is declared here once — that a database exists, that a bucket
 * exists, what engine backs it — and bound somewhere else: to a real connection
 * string and a real bucket name, per environment, from the environment. The
 * split is the point. Your staging and your production run the same commit and
 * must not share a bucket, so *which* bucket can never live in a committed file;
 * *that* there is one is a property of your code and belongs beside it.
 *
 * The runtime reads this file at boot and reports, for every declaration,
 * whether it is bound. Nothing here is silent.
 */
import { bucket, database } from "@rebasepro/types";

/**
 * The project's database, bound from `DATABASE_URL`.
 *
 * Implicit — a backend has one whether or not this line is here. It is written
 * out so that the second one has somewhere obvious to go.
 */
export const main = database();

/**
 * A second database, if you ever want one.
 *
 * Bound from `DATABASE_URL__ANALYTICS`: the key, uppercased, after a double
 * underscore. Every resource follows that rule, and the default-keyed one reads
 * the plain unsuffixed variable.
 *
 * export const analytics = database("analytics");
 */

/**
 * Object storage.
 *
 * Uncomment to give this project a bucket. The default-keyed one binds from the
 * plain `S3_BUCKET` / `GCS_BUCKET` / `STORAGE_BUCKET`; a named one appends its
 * key, so `bucket("media")` reads `S3_BUCKET__MEDIA`.
 *
 * export const files = bucket({ engine: "s3" });
 * export const media = bucket("media", { engine: "s3" });
 *
 * ## When you have several on one provider
 *
 * Name an `account` and they share one credential set instead of repeating it:
 *
 * export const media   = bucket("media",   { engine: "s3", account: "minio" });
 * export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
 *
 * That reads `S3_BUCKET__MEDIA` and `S3_BUCKET__AVATARS` — each bucket keeps its
 * own name — while `S3_ACCESS_KEY_ID__MINIO`, `S3_SECRET_ACCESS_KEY__MINIO` and
 * `S3_ENDPOINT__MINIO` are read once for both. Rotating that key is then one
 * edit rather than one per bucket. A per-bucket value still wins where you set
 * one, so a single source can be moved to another provider without breaking the
 * rest off their shared account.
 */
