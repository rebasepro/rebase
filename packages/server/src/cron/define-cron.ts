import type { CronJobDefinition } from "@rebasepro/types";

/**
 * Typed authoring helper for a cron job file. Identity at runtime —
 * a plain default-exported {@link CronJobDefinition} works identically;
 * this adds type inference and autocomplete.
 *
 * @see {@link defineFunction} for the equivalent custom-functions helper.
 *
 * @example
 * ```ts
 * import { defineCron } from "@rebasepro/server";
 *
 * export default defineCron({
 *     name: "Nightly cleanup",
 *     schedule: "0 3 * * *",
 *     async handler({ rebase, log }) {
 *         // `dataAsAdmin` bypasses RLS. A cron has no per-request user, so
 *         // there is no policy to fall back on — scope the filters yourself.
 *         const { data: expired } = await rebase.dataAsAdmin.sessions.find({
 *             where: { expired: ["==", true] },
 *         });
 *         for (const session of expired) {
 *             await rebase.dataAsAdmin.sessions.delete(session.id as string);
 *         }
 *         log(`Deleted ${expired.length} expired sessions`);
 *     },
 * });
 * ```
 */
export function defineCron(definition: CronJobDefinition): CronJobDefinition {
    return definition;
}
