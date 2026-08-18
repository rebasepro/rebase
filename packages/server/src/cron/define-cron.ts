import type { CronJobDefinition } from "@rebasepro/types";

/**
 * Typed authoring helper for a cron job file. Identity at runtime —
 * a plain default-exported {@link CronJobDefinition} works identically;
 * this adds type inference and autocomplete.
 *
 * @see {@link defineFunction} for the equivalent custom-functions helper.
 *
 * `ctx.rebase` is the `rebase` singleton itself — the same object a custom
 * function is handed — so `rebase.dataAsAdmin` here is **admin-scoped, not an
 * RLS bypass**: it is scoped once at boot as `SERVICE_IDENTITY`
 * (`{ uid: "service", roles: ["admin"] }`), and your policies are evaluated
 * against that identity, not skipped. See that constant's docblock. It clears
 * the default policies through their `rolesOverlap(['admin'])` arm, which is why
 * the distinction rarely shows; it shows against hand-written rules, where
 * `policy.serverContext()` (`rebase.uid() IS NULL`) is **false** for it. Use
 * `rebase.sql()` when you need the genuine bypass — owner connection, no
 * policies.
 *
 * @example
 * ```ts
 * import { defineCron } from "@rebasepro/server";
 *
 * export default defineCron({
 *     name: "Nightly cleanup",
 *     schedule: "0 3 * * *",
 *     async handler({ rebase, log }) {
 *         // `dataAsAdmin` runs as the service identity, with the `admin` role.
 *         // A cron has no per-request user to narrow that, so scope the
 *         // filters yourself — RLS will not do it for you here.
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
