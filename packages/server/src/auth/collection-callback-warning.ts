import { logger } from "../utils/logger";

/** The data callbacks the auth write path does not run. */
const DATA_CALLBACKS = ["beforeSave", "afterSave", "beforeDelete", "afterDelete"] as const;

/**
 * Warn when the auth collection hangs data callbacks that auth will not fire.
 *
 * Creating a user through the auth subsystem — registration, OAuth, the admin
 * user routes — writes to the user store directly, because that path owns
 * password hashing, identity rows and its own transaction. It deliberately does
 * not go through the collection save pipeline: a `beforeSave` able to rewrite
 * `password_hash` on its way to the database is a footgun, not a feature, and
 * the auth hooks (`afterUserCreate`, `beforeUserCreate`, …) exist to hang
 * behaviour off those events with the right contract.
 *
 * The cost is a reasonable expectation quietly not being met: someone puts
 * "send the welcome email" in `afterSave` on their users collection, tests it
 * by creating a user in the admin, and it works — because *that* is a
 * collection write. Then a real signup does nothing at all. Which is why this
 * is said at boot, naming the callbacks that will not run.
 */
export function warnOnAuthCollectionDataCallbacks(collection?: {
    slug?: string;
    callbacks?: Record<string, unknown>;
}): void {
    if (!collection?.callbacks) return;

    const declared = DATA_CALLBACKS.filter(name => typeof collection.callbacks?.[name] === "function");
    if (declared.length === 0) return;

    logger.warn(
        `[Auth] The auth collection "${collection.slug}" defines ` +
        `${declared.join("/")} callback(s), but these do NOT fire when users are ` +
        `created or updated through the auth system (registration, admin, OAuth) — ` +
        `that path bypasses the collection save pipeline. Use auth hooks ` +
        `(afterUserCreate, beforeUserCreate, afterUserDelete, …) for those side effects.`
    );
}
