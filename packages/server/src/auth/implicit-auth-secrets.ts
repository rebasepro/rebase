import { isColumnBuilder, type CompiledTable } from "@rebasepro/types";
import { logger } from "../utils/logger";

/**
 * Say so when the auth table serves a secret column it did not mark private.
 *
 * The users table is the one a project is *expected* to redeclare, and every
 * protection the default carried has to be restated in the copy — the one that
 * is invisible when it goes missing is "never on the wire". The result once was
 * a users table that hid the password hash from the admin panel and served it
 * to anyone whose read policy admitted the row — what the platform's own
 * control plane did.
 *
 * The table compiler restates it: a `defineAuthTable`'s secret columns (which
 * ones is decided once, by `authSecretsMissingExclusion` in `@rebasepro/common`)
 * come out `private` in the descriptor whatever the declaration says, and every
 * reader — the data driver's row pipeline, the write validation, the schema
 * served to clients — reads the descriptor. What is left for the server is to
 * tell the developer, so the declaration says what the runtime does.
 *
 * @module
 */

/**
 * The secret columns of the auth table the compiler made private on its own —
 * private in the descriptor, not `.private()` in the definition — each logged
 * once with what to write.
 *
 * @returns the columns, per table (for tests).
 */
export function warnOnImplicitAuthSecrets(tables: readonly CompiledTable[]): Array<{ slug: string; columns: string[] }> {
    const found: Array<{ slug: string; columns: string[] }> = [];
    for (const { descriptor, def } of tables) {
        if (descriptor.auth === undefined) continue;
        const declared: Record<string, unknown> = def.config.columns;
        const columns = descriptor.columns
            .filter(column => {
                if (column.private !== true) return false;
                const builder = declared[column.key];
                return isColumnBuilder(builder) && !builder.def.private;
            })
            .map(column => column.key);
        if (columns.length > 0) found.push({ slug: descriptor.slug, columns });
    }

    for (const { slug, columns } of found) {
        logger.warn(
            `[Auth] The auth table "${slug}" serves ${columns.map(c => `'${c}'`).join(", ")} ` +
            "without marking it private, so the column would have been served in every row a read " +
            "policy admits. Rebase has made it private. Mark the column `.private()` to make that " +
            "explicit, and regenerate the SDK."
        );
    }

    return found;
}
