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
 * import { defineCron } from "@rebasepro/server-core";
 *
 * export default defineCron({
 *     name: "Nightly cleanup",
 *     schedule: "0 3 * * *",
 *     async handler({ client, log }) {
 *         const deleted = await client.data.sessions.delete({ where: { expired: true } });
 *         log(`Deleted ${deleted} expired sessions`);
 *     },
 * });
 * ```
 */
export function defineCron(definition: CronJobDefinition): CronJobDefinition {
    return definition;
}
