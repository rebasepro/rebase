import type { AnyJsonField, JsonObjectOf, JsonShapeDef } from "./json";
import { isJsonField } from "./json";

/** The brand of a `defineRpc` result. */
export const RPC_BRAND = "rebase.rpc";

/**
 * Who may call an RPC.
 *
 * - `"public"`: anyone, signed in or not. An anonymous caller runs as the
 *   anonymous identity, so the function's own privileges and the tables'
 *   row-level security decide what it reaches. Always rate-limited.
 * - `"authenticated"`: any caller with an identity (a session, a guest
 *   session, an API key or the service key). Anonymous callers get `401`.
 *
 * @group Schema
 */
export type RpcAccess = "public" | "authenticated";

/**
 * The named arguments an RPC takes: each a `json.*` field, as in a JSON
 * column's shape. A key is the SQL function's parameter name.
 *
 * @group Schema
 */
export type RpcArgsShape = Record<string, AnyJsonField>;

/**
 * A per-caller limit on one RPC: `limit` calls per `windowMs`, counted where
 * the backend counts its function rate limits (`rateLimit` in
 * `@rebasepro/server/functions`).
 *
 * @group Schema
 */
export interface RpcRateLimit {
    /** Calls allowed per window, per caller. */
    limit: number;
    /** The sliding window, in milliseconds. */
    windowMs: number;
}

/**
 * The limit a `public` RPC is held to when it declares none: 120 calls a
 * minute per caller.
 *
 * @group Schema
 */
export const DEFAULT_PUBLIC_RPC_RATE_LIMIT: RpcRateLimit = { limit: 120, windowMs: 60_000 };

/**
 * What `defineRpc` takes besides the name.
 *
 * @group Schema
 */
export interface RpcConfig<A extends RpcArgsShape = RpcArgsShape> {
    /** Who may call it. See {@link RpcAccess}. */
    access: RpcAccess;
    /**
     * The named arguments, validated before the function runs: a key that is
     * not declared, a `.required()` one that is missing, or a value of the
     * wrong kind is refused with `400`, naming the field. Absent: the
     * function takes no arguments.
     */
    args?: A;
    /** The Postgres schema the function lives in. Default `"public"`. */
    schema?: string;
    /**
     * Run the call in a read-write transaction. Off by default: the function
     * runs read-only (and may be served by a read replica), so one that
     * inserts, updates or deletes fails until this is set.
     */
    write?: boolean;
    /**
     * A per-caller limit for this function. A `public` RPC is always limited:
     * {@link DEFAULT_PUBLIC_RPC_RATE_LIMIT} when this is absent. An
     * `authenticated` one is limited only when this is set.
     */
    rateLimit?: RpcRateLimit;
    /** What the function does, for whoever reads the declarations. */
    description?: string;
}

/**
 * A SQL function exposed at `POST /api/rpc/<name>`: what `defineRpc` returns.
 * Export it from `backend/schema/index.ts` to serve it.
 *
 * @group Schema
 */
export interface RpcDef<N extends string = string, A extends RpcArgsShape = RpcArgsShape> {
    readonly brand: typeof RPC_BRAND;
    /** The SQL function's name, which is also its URL segment. */
    readonly name: N;
    /** What it was defined with, as written. */
    readonly config: RpcConfig<A>;
}

/**
 * Any RPC, whatever its arguments.
 *
 * @group Schema
 */
export interface AnyRpcDef {
    readonly brand: typeof RPC_BRAND;
    readonly name: string;
    readonly config: RpcConfig<RpcArgsShape>;
}

/**
 * The arguments object an RPC takes, from its type:
 * `RpcArgs<typeof getPublicProposal>`. `.required()` keys are required, the
 * rest optional. Reads the definition structurally, so `import type` is
 * enough.
 *
 * ```ts
 * import type { getPublicProposal } from "../../backend/schema";
 * const args: RpcArgs<typeof getPublicProposal> = { token };
 * ```
 *
 * @group Schema
 */
export type RpcArgs<D> = D extends { readonly config: { readonly args?: infer A } }
    ? [NonNullable<A>] extends [RpcArgsShape] ? JsonObjectOf<NonNullable<A>> : Record<never, never>
    : Record<string, unknown>;

/** A SQL identifier as Rebase writes one: letters, digits, `_`, not starting with a digit. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Schemas whose functions are the database's or the server's own, never an RPC. */
const RESERVED_SCHEMAS = new Set(["rebase", "pg_catalog", "information_schema", "pg_toast"]);

/** A modifier on a JSON field that means something on a write and nothing on a call. */
function writeOnlyModifier(shape: JsonShapeDef): string | undefined {
    if (shape.transform !== undefined) return "`.transform()`";
    if ((shape.kind === "string" || shape.kind === "date") && shape.stamp !== undefined) {
        return shape.stamp === "createUser" || shape.stamp === "updateUser" ? "`.onCreateUser()` / `.onUpdateUser()`" : "`.onCreateNow()` / `.onUpdateNow()`";
    }
    if (shape.kind === "object") {
        for (const field of Object.values(shape.fields)) {
            const found = writeOnlyModifier(field);
            if (found) return found;
        }
    }
    if (shape.kind === "array") return writeOnlyModifier(shape.of);
    if (shape.kind === "oneOf") {
        for (const variant of Object.values(shape.variants)) {
            const found = writeOnlyModifier(variant);
            if (found) return found;
        }
    }
    return undefined;
}

function assertRateLimit(name: string, rateLimit: unknown): void {
    if (rateLimit === undefined) return;
    if (typeof rateLimit !== "object" || rateLimit === null) {
        throw new Error(`RPC "${name}": \`rateLimit\` is \`{ limit, windowMs }\`. A public RPC is always limited; to loosen it, raise \`limit\`.`);
    }
    const limit: unknown = Reflect.get(rateLimit, "limit");
    const windowMs: unknown = Reflect.get(rateLimit, "windowMs");
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
        throw new Error(`RPC "${name}": \`rateLimit.limit\` must be a positive integer.`);
    }
    if (typeof windowMs !== "number" || !Number.isFinite(windowMs) || windowMs <= 0) {
        throw new Error(`RPC "${name}": \`rateLimit.windowMs\` must be a positive number of milliseconds.`);
    }
}

/**
 * Expose a SQL function as `POST /api/rpc/<name>`, with a JSON body of named
 * arguments.
 *
 * Only declared functions are callable. Each call runs as the caller, like
 * `getSql(c)`: an anonymous caller as the anonymous identity, a signed-in one
 * as themselves under the tables' row-level security. A `SECURITY DEFINER`
 * function runs as its owner, as it does anywhere. The answer is the
 * function's result: an array of rows (or values) for a set-returning
 * function, the row or the value for any other.
 *
 * Export the result from `backend/schema/index.ts`, beside the tables.
 *
 * ```ts
 * // backend/schema/rpc.ts
 * import { defineRpc, json } from "@rebasepro/server/schema";
 *
 * export const getPublicProposal = defineRpc("get_public_proposal", {
 *     access: "public",
 *     args: { token: json.string().required() }
 * });
 * ```
 *
 * @group Schema
 */
export function defineRpc<const N extends string, A extends RpcArgsShape = Record<never, never>>(
    name: N,
    config: RpcConfig<A>
): RpcDef<N, A> {
    if (typeof name !== "string" || !IDENTIFIER.test(name)) {
        throw new Error(
            `defineRpc: ${JSON.stringify(name)} is not a function name an RPC can have. Use the SQL function's ` +
            "name as Postgres stores it: letters, digits and _, not starting with a digit (an unquoted " +
            "`CREATE FUNCTION getProposal` is stored as `getproposal`)."
        );
    }
    if (typeof config !== "object" || config === null) {
        throw new Error(`RPC "${name}" needs a config: \`defineRpc("${name}", { access: "public" | "authenticated" })\`.`);
    }
    const access: unknown = config.access;
    if (access !== "public" && access !== "authenticated") {
        throw new Error(
            `RPC "${name}": \`access\` must be "public" or "authenticated" (received ${JSON.stringify(access)}). ` +
            "It is required: who may call a function is a decision, not a default."
        );
    }
    const schema = config.schema ?? "public";
    if (typeof schema !== "string" || !IDENTIFIER.test(schema)) {
        throw new Error(`RPC "${name}": \`schema\` ${JSON.stringify(schema)} is not a schema name (letters, digits and _).`);
    }
    if (RESERVED_SCHEMAS.has(schema)) {
        throw new Error(`RPC "${name}": the "${schema}" schema holds the database's or the server's own functions, which are never exposed as RPCs.`);
    }
    if (config.args !== undefined) {
        if (typeof config.args !== "object" || config.args === null || Array.isArray(config.args)) {
            throw new Error(`RPC "${name}": \`args\` is an object of \`json.*\` fields, one per named argument.`);
        }
        for (const [key, field] of Object.entries(config.args)) {
            if (!IDENTIFIER.test(key)) {
                throw new Error(`RPC "${name}": argument ${JSON.stringify(key)} is not a SQL parameter name (letters, digits and _).`);
            }
            if (!isJsonField(field)) {
                throw new Error(`RPC "${name}": argument "${key}" must be a \`json.*\` field, such as \`json.string()\`.`);
            }
            const modifier = writeOnlyModifier(field.shape);
            if (modifier) {
                throw new Error(
                    `RPC "${name}": argument "${key}" uses ${modifier}, which applies to a row being written, not to a ` +
                    "call. Read the caller inside the function instead (`auth.uid()`, `now()`)."
                );
            }
        }
    }
    if (config.write !== undefined && typeof config.write !== "boolean") {
        throw new Error(`RPC "${name}": \`write\` is true or false.`);
    }
    assertRateLimit(name, config.rateLimit);
    return { brand: RPC_BRAND, name, config };
}

/**
 * Whether a value is the result of `defineRpc`, from this copy of the package
 * or another.
 *
 * @group Schema
 */
export function isRpcDef(value: unknown): value is AnyRpcDef {
    return typeof value === "object" && value !== null && "brand" in value && value.brand === RPC_BRAND;
}
