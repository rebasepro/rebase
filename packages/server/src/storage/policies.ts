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
    segments: string[];
    /** True when the last segment is `**`. */
    trailing: boolean;
    operations: Set<StorageOperation>;
    allow: StoragePolicy["allow"];
    source: string;
}

/**
 * Split a key into segments, dropping empty ones.
 *
 * Empty segments come from a leading slash or a `//`, and treating them as real
 * would let `users//x` match a pattern expecting a captured segment with the
 * empty string. Keys reaching here are already sanitized against traversal; this
 * is about matching, not safety.
 */
function segmentsOf(value: string): string[] {
    return value.split("/").filter(segment => segment.length > 0);
}

function compile(policy: StoragePolicy, index: number): CompiledPolicy {
    const label = `storagePolicies[${index}]`;

    if (typeof policy.path !== "string" || policy.path.trim() === "") {
        throw new StoragePolicyError(`${label}: \`path\` must be a non-empty string.`);
    }

    const segments = segmentsOf(policy.path);
    if (segments.length === 0) {
        throw new StoragePolicyError(
            `${label}: \`path\` "${policy.path}" names no segments. Use "**" to match every key.`
        );
    }

    const starIndex = segments.indexOf("**");
    if (starIndex !== -1 && starIndex !== segments.length - 1) {
        throw new StoragePolicyError(
            `${label}: "**" is only allowed as the last segment of \`path\`, and "${policy.path}" ` +
            "puts it in the middle. Use \"*\" for a single segment."
        );
    }

    const captures = segments.filter(s => s.startsWith(":")).map(s => s.slice(1));
    for (const name of captures) {
        if (name === "") {
            throw new StoragePolicyError(`${label}: a ":" placeholder in "${policy.path}" has no name.`);
        }
        if (captures.filter(c => c === name).length > 1) {
            throw new StoragePolicyError(
                `${label}: "${policy.path}" captures ":${name}" twice, so one would silently win.`
            );
        }
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
        segments,
        trailing: starIndex !== -1,
        operations: new Set(policy.operations ?? ALL_OPERATIONS),
        allow: policy.allow,
        source: policy.path
    };
}

/** Match a key's segments against a compiled pattern, capturing as it goes. */
function match(compiled: CompiledPolicy, key: string): Record<string, string> | undefined {
    const keySegments = segmentsOf(key);
    const pattern = compiled.trailing ? compiled.segments.slice(0, -1) : compiled.segments;

    if (compiled.trailing ? keySegments.length < pattern.length : keySegments.length !== pattern.length) {
        return undefined;
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < pattern.length; i++) {
        const expected = pattern[i];
        const actual = keySegments[i];
        if (expected === "*") continue;
        if (expected.startsWith(":")) {
            params[expected.slice(1)] = actual;
            continue;
        }
        if (expected !== actual) return undefined;
    }
    return params;
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

            const params = match(policy, ctx.key);
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
}): StorageAuthorize | undefined {
    if (config.storagePolicies?.length) {
        return compileStoragePolicies(config.storagePolicies, config.storageAuthorize);
    }
    return config.storageAuthorize;
}
