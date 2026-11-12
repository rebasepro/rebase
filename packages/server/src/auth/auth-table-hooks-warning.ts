import type { TableHooks } from "@rebasepro/types";
import { logger } from "../utils/logger";

/** The table hooks the auth write path does not run. */
const DATA_HOOKS = ["beforeSave", "afterSave", "beforeDelete", "afterDelete"] as const;

/**
 * Warn when the auth table declares write hooks that auth will not fire.
 *
 * Creating a user through the auth subsystem — registration, OAuth, the admin
 * user routes — writes to the user store directly, because that path owns
 * password hashing, identity rows and its own transaction. It deliberately does
 * not go through the table's save pipeline: a `beforeSave` able to rewrite
 * `password_hash` on its way to the database is a footgun, not a feature, and
 * the auth hooks (`afterUserCreate`, `beforeUserCreate`, …) exist to hang
 * behaviour off those events with the right contract.
 *
 * The cost is a reasonable expectation quietly not being met: someone puts
 * "send the welcome email" in `hooks.afterSave` on their users table, tests it
 * by creating a user in the admin, and it works — because *that* is a table
 * write. Then a real signup does nothing at all. Which is why this is said at
 * boot, naming the hooks that will not run.
 */
export function warnOnAuthTableDataHooks(table?: { descriptor: { slug: string }; hooks?: TableHooks }): void {
    const hooks = table?.hooks;
    if (!table || !hooks) return;

    const declared = DATA_HOOKS.filter(name => typeof hooks[name] === "function");
    if (declared.length === 0) return;

    logger.warn(
        `[Auth] The auth table "${table.descriptor.slug}" declares ` +
        `${declared.join("/")} hook(s), but these do NOT fire when users are ` +
        `created or updated through the auth system (registration, admin, OAuth) — ` +
        `that path bypasses the table's save pipeline. Use auth hooks ` +
        `(afterUserCreate, beforeUserCreate, afterUserDelete, …) for those side effects.`
    );
}
