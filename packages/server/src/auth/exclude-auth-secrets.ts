import { authSecretsMissingExclusion, type AuthSecretCandidate } from "@rebasepro/common";
import { logger } from "../utils/logger";

/**
 * Keep the auth collection's secret columns off the API, whoever declared it.
 *
 * `users` is the one collection a project is *expected* to redeclare: it is
 * scaffolded into `config/collections/users.ts` so the panel can present it, and
 * a slug collision replaces the framework's default outright rather than merging
 * with it. So every protection the default carried has to be restated by hand in
 * the copy — and the one that is invisible when it goes missing is
 * `excludeFromApi`.
 *
 * It is invisible because the neighbouring options *look* like they do the same
 * job. `admin.hideFromCollection` and `admin.disabled.hidden` keep a field out of
 * the CMS, which is what a person editing that file is thinking about, and a
 * declaration carrying both of those reads as careful. Neither one strips the
 * column from a row on the wire; only `excludeFromApi` does. The result is a
 * users collection that hides the password hash from the admin panel and serves
 * it to anyone whose read policy admits the row.
 *
 * Which is not hypothetical: it is what the platform's own control plane did,
 * where the read policy deliberately admits co-members so the Members view can
 * name them, and every colleague's browser was therefore handed everyone's
 * scrypt hash and any pending email-verification token.
 *
 * So the framework restates it. Not by rejecting the collection — a boot failure
 * over a field a developer never thought about is a bad trade, and an existing
 * deployment would stop rather than start protecting itself — but by adding the
 * flag and saying so. Which columns count is decided once, by
 * {@link authSecretsMissingExclusion} in `@rebasepro/common`, and every
 * `CollectionRegistry` applies the same rule to the copies it makes — which is
 * how the panel, building its registry from the project's file as written,
 * agrees with the server.
 */

/**
 * Force `excludeFromApi` onto the auth collection's secret columns.
 *
 * Mutates in place, for what reads the collection configs directly rather than a
 * registry's normalized copies. Run it before the collections are handed on, so
 * those readers never see a config without the flag.
 *
 * @returns the columns it had to fix, per collection — for the caller to log and
 *          for tests to assert on.
 */
export function enforceAuthSecretExclusion(
    collections: readonly unknown[]
): Array<{ slug: string; columns: string[] }> {
    const fixed: Array<{ slug: string; columns: string[] }> = [];

    for (const raw of collections) {
        const collection = raw as (AuthSecretCandidate & { slug?: string }) | undefined;
        if (!collection?.properties) continue;

        const columns = authSecretsMissingExclusion(collection);
        for (const key of columns) {
            const property = collection.properties[key];
            if (property) property.excludeFromApi = true;
        }

        if (columns.length > 0) {
            fixed.push({ slug: collection.slug ?? "(unnamed)", columns });
        }
    }

    for (const { slug, columns } of fixed) {
        logger.warn(
            `[Auth] The auth collection "${slug}" declares ${columns.map(c => `'${c}'`).join(", ")} ` +
            "without excludeFromApi, so the column would have been served in every row a read " +
            "policy admits — hiding a field in the admin panel does not strip it from the API. " +
            "Rebase has excluded it. Add `excludeFromApi: true` to the property to make that " +
            "explicit, and regenerate the SDK."
        );
    }

    return fixed;
}
