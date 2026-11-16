/**
 * Where the VAPID keys come from.
 *
 * In order: `push.vapid` in the backend options, then `REBASE_VAPID_PUBLIC_KEY`
 * and `REBASE_VAPID_PRIVATE_KEY`. Outside production, with neither, a pair is
 * generated once and kept in `.rebase-dev-secrets.json` beside the other
 * development secrets — kept, because a browser's subscription is bound to the
 * public key it subscribed with, and a new key on every restart would silently
 * orphan every subscription made before it. In production nothing is generated:
 * a production key is one an operator can rotate and back up, so push stays
 * off and says which variables to set.
 */
import type { DevSecretStore } from "../dev-secrets";
import { generateVapidKeys, validateVapidKeys, type VapidKeys } from "./web-push-crypto";

export const VAPID_PUBLIC_ENV = "REBASE_VAPID_PUBLIC_KEY";
export const VAPID_PRIVATE_ENV = "REBASE_VAPID_PRIVATE_KEY";
export const VAPID_SUBJECT_ENV = "REBASE_VAPID_SUBJECT";

export type VapidResolution =
    | { ok: true; keys: VapidKeys; subject: string; source: "options" | "env" | "dev" }
    | { ok: false; reason: string };

const HOW_TO_GENERATE = "Generate a pair with `npx web-push generate-vapid-keys`.";

export function resolveVapid(input: {
    vapid?: Partial<VapidKeys> & { subject?: string };
    env: Record<string, string | undefined>;
    isProduction: boolean;
    /** The development secret cache, or undefined where none may be written (production, tests). */
    devStore?: DevSecretStore;
}): VapidResolution {
    const { env, isProduction } = input;
    let keys: VapidKeys | undefined;
    let source: "options" | "env" | "dev" = "options";

    if (input.vapid?.publicKey || input.vapid?.privateKey) {
        if (!input.vapid.publicKey || !input.vapid.privateKey) {
            return { ok: false, reason: "push.vapid needs both publicKey and privateKey." };
        }
        keys = { publicKey: input.vapid.publicKey, privateKey: input.vapid.privateKey };
    } else {
        const publicKey = env[VAPID_PUBLIC_ENV]?.trim();
        const privateKey = env[VAPID_PRIVATE_ENV]?.trim();
        if (publicKey || privateKey) {
            if (!publicKey || !privateKey) {
                return { ok: false, reason: `Push needs both ${VAPID_PUBLIC_ENV} and ${VAPID_PRIVATE_ENV}; only one is set.` };
            }
            keys = { publicKey, privateKey };
            source = "env";
        }
    }

    if (!keys) {
        if (isProduction) {
            return {
                ok: false,
                reason: `Push is on but has no VAPID keys. Set ${VAPID_PUBLIC_ENV} and ${VAPID_PRIVATE_ENV} (and ${VAPID_SUBJECT_ENV}). ${HOW_TO_GENERATE}`
            };
        }
        const cachedPublic = input.devStore?.get(VAPID_PUBLIC_ENV);
        const cachedPrivate = input.devStore?.get(VAPID_PRIVATE_ENV);
        if (cachedPublic && cachedPrivate && validateVapidKeys({ publicKey: cachedPublic, privateKey: cachedPrivate }) === null) {
            keys = { publicKey: cachedPublic, privateKey: cachedPrivate };
        } else {
            keys = generateVapidKeys();
            input.devStore?.set(VAPID_PUBLIC_ENV, keys.publicKey);
            input.devStore?.set(VAPID_PRIVATE_ENV, keys.privateKey);
        }
        source = "dev";
    }

    const invalid = validateVapidKeys(keys);
    if (invalid) {
        return { ok: false, reason: `The VAPID keys are unusable: ${invalid}. ${HOW_TO_GENERATE}` };
    }

    // `sub` tells a push service whom to contact about this sender. Apple
    // refuses a message without a valid one, so production needs a real one.
    const subject = input.vapid?.subject?.trim() || env[VAPID_SUBJECT_ENV]?.trim() || publicUrlSubject(env.REBASE_PUBLIC_URL)
        || (isProduction ? undefined : "mailto:push@localhost.invalid");
    if (!subject) {
        return {
            ok: false,
            reason: `Push needs a contact for the push services: set ${VAPID_SUBJECT_ENV} to a mailto: address or an https:// URL.`
        };
    }
    if (!/^(mailto:.+|https:\/\/.+)$/.test(subject)) {
        return { ok: false, reason: `${VAPID_SUBJECT_ENV} must be a mailto: address or an https:// URL; got ${JSON.stringify(subject)}.` };
    }
    return { ok: true, keys, subject, source };
}

function publicUrlSubject(publicUrl: string | undefined): string | undefined {
    if (!publicUrl) return undefined;
    try {
        const url = new URL(publicUrl);
        return url.protocol === "https:" ? url.origin : undefined;
    } catch {
        return undefined;
    }
}
