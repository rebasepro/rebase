import { z } from "zod";

import type { UserManagementAdapter } from "@rebasepro/types";
import { logger } from "../utils/logger";
import { isBootstrapWindowOpen } from "./registration-policy";

/**
 * Create the operator's admin account from the environment, before anyone else
 * can claim it.
 *
 * Every fresh Rebase deployment has a window between "the database is empty"
 * and "the operator has registered", and the registration policy deliberately
 * admits the first registration and promotes it to admin — otherwise an empty
 * database is a dead end, since `POST /admin/bootstrap` needs a caller who is
 * already signed in. That is a reasonable rule for a laptop and a bad one for
 * anything with a public hostname: the shipped artifacts bring DNS and TLS up
 * before their operator has typed anything, so the window is open to the
 * internet, and whoever reaches the form first owns the deployment.
 *
 * A closed window needs a way in that is not a race, which is this: the
 * operator names the first account in the same place they already put the
 * database URL and the JWT secret. Then the artifacts can ship with
 * self-registration off and nothing is left to be claimed.
 *
 * Runs only against an EMPTY user table. Not "no admin exists" — a deployment
 * that has users has already been bootstrapped, and minting an admin into it
 * from an environment variable would be a way to take over a running system by
 * editing a manifest.
 */
export interface SeedAdminEnv {
    REBASE_ADMIN_EMAIL?: string;
    REBASE_ADMIN_PASSWORD?: string;
    /** Read only to decide whether an unrequested seed is worth a warning. */
    NODE_ENV?: string;
}

export type SeedAdminOutcome =
    /** Created, with the new user's id. */
    | { status: "created"; uid: string }
    /** Nothing was asked for. */
    | { status: "not-requested" }
    /** Asked for, but the deployment already has users. */
    | { status: "already-bootstrapped" }
    /** Asked for incompletely, or the create failed. `reason` has been logged. */
    | { status: "skipped"; reason: string };

/**
 * @param users  The adapter's user management, or undefined when the deployment
 *               has no built-in user store to seed into.
 * @param env    Where the credentials come from. Injected so the test does not
 *               have to mutate `process.env`.
 */
export async function seedInitialAdmin(
    users: UserManagementAdapter | undefined,
    env: SeedAdminEnv = process.env as SeedAdminEnv
): Promise<SeedAdminOutcome> {
    const email = env.REBASE_ADMIN_EMAIL?.trim();
    const password = env.REBASE_ADMIN_PASSWORD;

    if (!email && !password) {
        // Outside production the first registration becomes the admin, so an
        // absent seed is the normal laptop case and not worth a line. In
        // production that window is shut (`isBootstrapWindowOpen`), which
        // means an empty table with no seed is a deployment nobody can
        // administer yet — say so at boot, once, while the operator is still
        // looking at the log.
        if (users && !isBootstrapWindowOpen(env)) {
            try {
                const existing = await users.listUsers({ limit: 1 });
                if ((existing.total ?? existing.users.length) === 0) {
                    logger.warn(
                        "⚠️ No users exist and REBASE_ADMIN_EMAIL is not set. In production the first " +
                        "account to register is NOT promoted to admin; set REBASE_ADMIN_EMAIL and " +
                        "REBASE_ADMIN_PASSWORD before the first sign-up, or assign the admin role " +
                        "with the service key."
                    );
                }
            } catch {
                // A count that fails here fails louder elsewhere at boot.
            }
        }
        return { status: "not-requested" };
    }

    // Half a credential is a typo, not a request, and the deployment it
    // produces — self-registration off, no admin, no way in — is one nobody can
    // recover without a psql prompt. Say so at boot.
    if (!email || !password) {
        const missing = email ? "REBASE_ADMIN_PASSWORD" : "REBASE_ADMIN_EMAIL";
        const reason = `${missing} is not set, so the initial admin was not created.`;
        logger.warn(`⚠️ ${reason} Both are needed, or neither.`);
        return { status: "skipped", reason };
    }

    if (!users) {
        const reason = "this deployment has no built-in user store to seed an admin into.";
        logger.warn(`⚠️ REBASE_ADMIN_EMAIL is set, but ${reason}`);
        return { status: "skipped", reason };
    }

    // The same rule POST /auth/login parses its body with, deliberately reusing
    // zod rather than approximating it — an address this refuses is an account
    // nobody can sign in to, and the two have to agree about which those are.
    //
    // `admin@localhost` is the case that found this. It was the default in
    // quickstart.sh, it seeds without complaint, and it is not a valid address
    // to `z.string().email()`, so every login with it was a 400. The operator
    // got a running server, an admin row, `needsSetup: false` — so no first-run
    // path either — and no way in. Refused here, at boot, where there is still
    // something to read the message.
    if (!z.string().email().max(255).safeParse(email).success) {
        const reason = `REBASE_ADMIN_EMAIL is not an address the login route accepts: ${email}`;
        logger.error(`❌ ${reason} The initial admin was not created.`);
        return { status: "skipped", reason };
    }

    if (password.length < 12) {
        // Refused rather than warned: this account is an admin on a host that
        // is, by the time this runs, already answering requests.
        const reason = "REBASE_ADMIN_PASSWORD is shorter than 12 characters.";
        logger.error(`❌ ${reason} The initial admin was not created.`);
        return { status: "skipped", reason };
    }

    try {
        const existing = await users.listUsers({ limit: 1 });
        if ((existing.total ?? existing.users.length) > 0) {
            logger.debug("Initial admin not seeded: this deployment already has users.");
            return { status: "already-bootstrapped" };
        }

        const created = await users.createUser({ email, password });
        await users.setUserRoles(created.id, ["admin"]);

        logger.info(
            `👤 Created the initial admin account for ${email} from the environment. ` +
            "Nothing else can claim this deployment; sign in and change the password."
        );
        return { status: "created", uid: created.id };
    } catch (err) {
        // Not fatal. A server that refuses to start because it could not seed an
        // account is worse than one that starts and says why — especially on the
        // second boot of a replica set, where losing the race to a sibling is
        // the normal outcome and not an error.
        const reason = err instanceof Error ? err.message : String(err);
        logger.error(`❌ Could not create the initial admin account for ${email}: ${reason}`);
        return { status: "skipped", reason };
    }
}
