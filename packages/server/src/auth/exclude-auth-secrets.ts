import { authSecretsMissingExclusion, type AuthSecretCandidate } from "@rebasepro/common";
import { logger } from "../utils/logger";

/**
 * Keep the auth table's secret columns off the API, whoever declared it.
 *
 * The users table is the one a project is *expected* to redeclare, and every
 * protection the default carried has to be restated in the copy — the one that
 * is invisible when it goes missing is "never on the wire". Neighbouring panel
 * options (hidden in a form, hidden in a list) look like they do the same job;
 * none strips the column from a row. The result once was a users table that
 * hid the password hash from the admin panel and served it to anyone whose
 * read policy admitted the row — what the platform's own control plane did.
 *
 * So the framework restates it, not by refusing the table but by marking the
 * column and saying so. Which columns count is decided once, by
 * {@link authSecretsMissingExclusion} in `@rebasepro/common`; the table
 * compiler applies the same rule to a `defineAuthTable` (its secrets come out
 * `.private()`), and this applies it to what a driver reports.
 */

/**
 * Mark the auth table's secret columns hidden on the collections handed to the
 * data driver.
 *
 * The B-R7 seam of this module: the driver still serves rows from lowered
 * collections, and for a declared auth table the compiler has already made the
 * secrets `.private()` (so the lowering carries the flag and nothing is fixed
 * here). What remains is a collection a driver reports itself (introspection),
 * which only this pass can protect. Mutates in place, before the collections
 * are handed on, so no reader sees one without the flag.
 *
 * @returns the columns it had to fix, per table — for the caller to log, to
 *          mark the same columns private on the descriptors, and for tests.
 */
export function enforceAuthSecretExclusion(
    collections: readonly (AuthSecretCandidate & { slug?: string })[]
): Array<{ slug: string; columns: string[] }> {
    const fixed: Array<{ slug: string; columns: string[] }> = [];

    for (const collection of collections) {
        if (!collection.properties) continue;

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
            `[Auth] The auth table "${slug}" serves ${columns.map(c => `'${c}'`).join(", ")} ` +
            "without marking it private, so the column would have been served in every row a read " +
            "policy admits. Rebase has made it private. Mark the column `.private()` to make that " +
            "explicit, and regenerate the SDK."
        );
    }

    return fixed;
}
