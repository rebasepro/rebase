/**
 * Declarative access control for storage.
 *
 * Storage is not under row-level security, so `storageAuthorize` — a hook, a
 * piece of imperative code — was the whole access-control model. That is the one
 * place the claim "security lives in the database" does not hold, and it shows
 * in the shape of the alternative: without a hook, **any authenticated caller
 * may read, overwrite, delete or list any key they can name**, because storage
 * keys share one flat namespace.
 *
 * A policy list says the same things declaratively, and can be read without
 * running it:
 *
 * ```ts
 * storagePolicies: [
 *     { path: "public/**", operations: ["read"], allow: "public" },
 *     { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
 * ]
 * ```
 *
 * ## Deny by default, and why that is the whole design
 *
 * A key matched by no policy is refused. That makes every widening an explicit,
 * reviewable line, and it makes a mistake in this module fail *closed* — a
 * pattern that fails to match denies access rather than granting it. Authz code
 * that fails open is worth more to an attacker than the feature is to anyone
 * else, so the bias is deliberate and absolute.
 *
 * ## The hook remains, as an escape hatch and not as a fallback
 *
 * Ownership frequently lives in a row rather than in a key, which no pattern can
 * express. So when policies match nothing, an explicit `storageAuthorize` is
 * consulted before the request is refused. Present, it can widen; absent, the
 * answer is no. Policies never *narrow* what the hook allowed and the hook never
 * overrides a policy denial — each can only say yes, which keeps "who allowed
 * this?" answerable by reading either one alone.
 */
import type {
    StorageAuthorize,
    StorageAuthorizeContext,
    StorageOperation
} from "@rebasepro/types";
import {
    compileStoragePattern,
    matchStoragePattern,
    StoragePatternError,
    type CompiledStoragePattern
} from "./path-pattern";

/** Everything a predicate is told, plus whatever the path captured. */
export interface StoragePolicyContext extends StorageAuthorizeContext {
    /** Segments captured by `:name` placeholders in the matched path. */
    params: Record<string, string>;
}

export type StoragePolicyPredicate = (ctx: StoragePolicyContext) => boolean | Promise<boolean>;

export interface StoragePolicy {
    /**
     * A key pattern, matched segment by segment against the sanitized key.
     *
     * - a literal segment matches itself
     * - `*` matches exactly one segment
     * - `:name` matches one segment and captures it
     * - `**` matches the rest of the key, including nothing, and is only
     *   allowed as the final segment
     */
    path: string;
    /** Which operations this grants. Defaults to every one of them. */
    operations?: StorageOperation[];
    /**
     * Who it grants to.
     *
     * - `"public"` — anyone, signed in or not
     * - `"authenticated"` — any caller with a uid
     * - a predicate — anything else, given the captured params and the user
     */
    allow: "public" | "authenticated" | StoragePolicyPredicate;
}

export class StoragePolicyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StoragePolicyError";
    }
}

const ALL_OPERATIONS: StorageOperation[] = ["read", "write", "delete", "list"];

interface CompiledPolicy {
    pattern: CompiledStoragePattern;
    operations: Set<StorageOperation>;
    allow: StoragePolicy["allow"];
}

function compile(policy: StoragePolicy, index: number): CompiledPolicy {
    const label = `storagePolicies[${index}]`;

    // Rethrown as a `StoragePolicyError`: the pattern language is shared with
    // `storageTriggers`, but a caller catching a bad *policy* should not have to
    // know that, and the message already names the policy that was wrong.
    let pattern: CompiledStoragePattern;
    try {
        pattern = compileStoragePattern(policy.path, label);
    } catch (err) {
        throw err instanceof StoragePatternError ? new StoragePolicyError(err.message) : err;
    }

    if (policy.operations !== undefined) {
        if (!Array.isArray(policy.operations) || policy.operations.length === 0) {
            throw new StoragePolicyError(
                `${label}: \`operations\` is empty, so this policy grants nothing. Remove it to grant all, ` +
                "or name the operations."
            );
        }
        for (const operation of policy.operations) {
            if (!ALL_OPERATIONS.includes(operation)) {
                throw new StoragePolicyError(
                    `${label}: \`operations\` names "${operation}", which is not a storage operation. ` +
                    `Use ${ALL_OPERATIONS.map(o => `"${o}"`).join(", ")}.`
                );
            }
        }
    }

    if (policy.allow !== "public" && policy.allow !== "authenticated" && typeof policy.allow !== "function") {
        throw new StoragePolicyError(
            `${label}: \`allow\` must be "public", "authenticated", or a function. ` +
            "A policy with no `allow` grants nothing, which is never what was meant."
        );
    }

    return {
        pattern,
        operations: new Set(policy.operations ?? ALL_OPERATIONS),
        allow: policy.allow
    };
}

/**
 * Compile a policy list into a {@link StorageAuthorize}.
 *
 * Compiled once, at boot, so a malformed pattern fails the start rather than the
 * first upload. `fallback` is an explicit `storageAuthorize`, consulted only
 * when no policy matched.
 */
export function compileStoragePolicies(
    policies: StoragePolicy[],
    fallback?: StorageAuthorize
): StorageAuthorize {
    if (!Array.isArray(policies)) {
        throw new StoragePolicyError("`storagePolicies` must be an array.");
    }
    const compiled = policies.map(compile);

    return async (ctx: StorageAuthorizeContext): Promise<boolean> => {
        for (const policy of compiled) {
            if (!policy.operations.has(ctx.operation)) continue;

            const params = matchStoragePattern(policy.pattern, ctx.key);
            if (!params) continue;

            if (policy.allow === "public") return true;
            if (policy.allow === "authenticated") {
                // A matched policy that requires a user and has none keeps
                // looking: another policy may grant the same key publicly.
                if (ctx.user?.uid) return true;
                continue;
            }

            if (await policy.allow({ ...ctx, params })) return true;
        }

        // Nothing granted it. The hook may still, which is what makes
        // row-owned objects expressible; without one, the answer is no.
        if (fallback) return await fallback(ctx);
        return false;
    };
}

/**
 * The access-control function for a configuration, or `undefined` when it
 * declares none.
 *
 * Kept separate from {@link compileStoragePolicies} so `init` has one call to
 * make and one thing to reason about: policies, a hook, both, or neither.
 */
export function resolveStorageAccessControl(config: {
    storagePolicies?: StoragePolicy[];
    storageAuthorize?: StorageAuthorize;
    /** `storagePublicRead: true` — see {@link publicReadOnlyAuthorize}. */
    storagePublicRead?: boolean;
}): StorageAuthorize | undefined {
    if (config.storagePolicies?.length) {
        return compileStoragePolicies(config.storagePolicies, config.storageAuthorize);
    }
    if (config.storageAuthorize) return config.storageAuthorize;
    if (config.storagePublicRead) return publicReadOnlyAuthorize;
    return undefined;
}

/**
 * What `storagePublicRead: true` on its own has to mean.
 *
 * The flag says "reads are public", and it satisfies the boot guard that
 * refuses a storage configuration with no access-control model. Those two facts
 * together were the hole: the flag only ever relaxed the READ gate, so writes,
 * deletes and listings fell back to the global `requireAuth` — and the
 * configuration this flag exists FOR is the public site, which the docs
 * themselves suggest running with auth off. The result was a bucket where an
 * anonymous caller could list every key, overwrite any file and delete it,
 * having passed a guard whose whole job is to prevent exactly that.
 *
 * So a bucket declared public-read, and nothing else, is public READ:
 * everything else is an admin's. A deployment that wants anonymous writes has
 * to say so, with a policy or a hook that spells out where.
 *
 * Reached only when neither policies nor a hook were configured, so it can
 * never narrow a decision someone actually made.
 */
export const publicReadOnlyAuthorize: StorageAuthorize = ({ operation, user }) => {
    if (operation === "read") return true;
    return (user?.roles ?? []).includes("admin");
};
