/**
 * Sign-up by magic link or email code (`auth.magicLinkCreatesUsers`).
 *
 * Both passwordless doors refuse an address with no account — silently, so
 * they do not say which addresses have one. A passwordless-only app then had
 * no way to create accounts at all. With the option on, and registration open,
 * an unknown address gets an account at request time — no password, unverified
 * — and the link or code mailed to it is what proves the address and signs it
 * in, exactly as for an existing account. Supabase's `shouldCreateUser`.
 *
 * @module
 */

import { normalizeEmail } from "@rebasepro/common";
import { logger } from "../utils/logger";
import type { AuthModuleConfig } from "./routes";
import type { ResolvedAuthHooks } from "./auth-hooks";
import type { CreateUserData, UserData } from "./interfaces";
import { isSteadyStateRegistrationOpen } from "./registration-policy";

/**
 * The account a passwordless request for `email` should mail, creating it
 * when the deployment lets passwordless requests sign people up. `null` when
 * there is none and none may be made — the caller answers as for any unknown
 * address.
 *
 * Registration's controls hold: the kill switch, `allowRegistration` (with no
 * first-user exception: the first admin is made by registering or by the
 * operator, never by whoever asks for a link first), `beforeUserCreate`,
 * `afterUserCreate` and the default role.
 */
export async function accountForPasswordlessRequest(
    config: AuthModuleConfig,
    ops: ResolvedAuthHooks,
    email: string
): Promise<UserData | null> {
    const authRepo = config.authRepo;
    const existing = await authRepo.getUserByEmail(email);
    if (existing || !config.magicLinkCreatesUsers) return existing;
    if (!isSteadyStateRegistrationOpen({
        disableSelfRegistration: config.disableSelfRegistration,
        allowRegistration: config.allowRegistration ?? false
    })) {
        return null;
    }

    let createData: CreateUserData = { email: normalizeEmail(email) };
    if (ops.beforeUserCreate) createData = await ops.beforeUserCreate(createData);

    let user: UserData;
    try {
        user = await authRepo.createUser(createData);
    } catch (error) {
        // Two requests for one new address raced; the other one made it.
        const made = await authRepo.getUserByEmail(email);
        if (made) return made;
        throw error;
    }
    if (config.defaultRole) await authRepo.assignDefaultRole(user.id, config.defaultRole);
    if (ops.afterUserCreate) {
        ops.afterUserCreate(user).catch((err: unknown) => {
            logger.error("[AuthHooks] afterUserCreate error", { error: err instanceof Error ? err.message : err });
        });
    }
    return user;
}
