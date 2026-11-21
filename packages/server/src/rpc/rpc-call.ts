/**
 * Calling a declared SQL function: what the catalogue says it takes and
 * returns, the one statement that calls it, and the answer's shape.
 *
 * The statement is built from the catalogue and the declaration alone: the
 * schema and function name the RPC declared, the parameter names and types
 * Postgres reports, quoted. The caller's values never enter its text — they
 * travel as one bound parameter, a JSON object that `json_to_record` turns
 * into the function's own types, as PostgREST does:
 *
 * ```sql
 * SELECT _r.* FROM json_to_record($1::json) AS _a("token" text),
 *     "public"."get_public_proposal"("token" => _a."token") AS _r
 * ```
 *
 * The answer follows PostgREST: a set-returning function answers an array (of
 * rows, or of values for `SETOF integer`), any other the row or the value
 * (`null` for `void`, or a row that is all nulls).
 *
 * @module
 */
import type { AnyRpcDef } from "@rebasepro/types";

/** Runs one statement as the caller: `getSql(c)`. */
export type RpcSqlRunner = (query: string, options?: { params?: unknown[]; write?: boolean }) => Promise<Record<string, unknown>[]>;

/** One parameter of a function, as `pg_proc` lists it. */
export interface RpcParameter {
    /** Its name, or `null` for an unnamed one. */
    name: string | null;
    /** Its type, as `format_type` spells it (`integer[]`, `timestamp with time zone`). */
    type: string;
    /** `i` in, `o` out, `b` inout, `v` variadic, `t` a `RETURNS TABLE` column. */
    mode: string;
}

/** One function of the declared name, as the catalogue describes it. */
export interface RpcCandidate {
    /** `RETURNS SETOF …` or `RETURNS TABLE (…)`. */
    returnsSet: boolean;
    /** What one result row is: a row of columns, a single value, or nothing (`void`). */
    returns: "row" | "value" | "void";
    /** How many trailing input parameters have a `DEFAULT`. */
    defaultCount: number;
    /** Every parameter, in order. */
    parameters: RpcParameter[];
}

/**
 * Every function of this schema and name. Read as the caller — `pg_proc` is
 * readable by every role — so it runs where the call will.
 */
const CATALOGUE_QUERY = `SELECT p.proretset AS returns_set,
       t.typtype::text AS return_kind,
       t.typname::text AS return_type,
       p.pronargdefaults::int AS default_count,
       COALESCE((
           SELECT json_agg(json_build_object('name', a.name, 'type', format_type(a.type, NULL), 'mode', COALESCE(a.mode::text, 'i')) ORDER BY a.position)
           FROM unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[]), p.proargnames, p.proargmodes)
               WITH ORDINALITY AS a(type, name, mode, position)
       ), '[]'::json) AS parameters
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_type t ON t.oid = p.prorettype
WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind = 'f'`;

function readParameters(raw: unknown): RpcParameter[] {
    const list: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) return [];
    return list.map((entry: unknown): RpcParameter => {
        const record = typeof entry === "object" && entry !== null ? entry : {};
        const name = Reflect.get(record, "name");
        const type = Reflect.get(record, "type");
        const mode = Reflect.get(record, "mode");
        return {
            name: typeof name === "string" && name !== "" ? name : null,
            type: typeof type === "string" ? type : "unknown",
            mode: typeof mode === "string" ? mode : "i"
        };
    });
}

/** A catalogue row as a {@link RpcCandidate}. */
export function candidateFromCatalogue(row: Record<string, unknown>): RpcCandidate {
    const kind = String(row.return_kind ?? "");
    const type = String(row.return_type ?? "");
    const returns: RpcCandidate["returns"] = kind === "p" && type === "void"
        ? "void"
        : kind === "c" || (kind === "p" && type === "record") ? "row" : "value";
    return {
        returnsSet: row.returns_set === true,
        returns,
        defaultCount: Number(row.default_count ?? 0),
        parameters: readParameters(row.parameters)
    };
}

/** Read the functions an RPC could call. Empty when the database has none of that name. */
export async function readCandidates(sql: RpcSqlRunner, def: AnyRpcDef): Promise<RpcCandidate[]> {
    const rows = await sql(CATALOGUE_QUERY, { params: [def.config.schema ?? "public", def.name] });
    return rows.map(candidateFromCatalogue);
}

/** The parameters a call passes, in order: in, inout and variadic. */
export function inputParameters(candidate: RpcCandidate): RpcParameter[] {
    return candidate.parameters.filter(parameter => parameter.mode === "i" || parameter.mode === "b" || parameter.mode === "v");
}

/** Why no function, or more than one, answers a call. */
export class RpcResolutionError extends Error {
    constructor(readonly reason: "missing" | "no-match" | "ambiguous", message: string) {
        super(message);
        this.name = "RpcResolutionError";
    }
}

/**
 * The function a call with these argument names reaches: the only one of the
 * name, or among overloads the one whose named inputs include every argument
 * sent and whose inputs without a default were all sent.
 */
export function resolveCandidate(def: AnyRpcDef, candidates: readonly RpcCandidate[], sent: readonly string[]): RpcCandidate {
    const qualified = `${def.config.schema ?? "public"}.${def.name}`;
    if (candidates.length === 0) {
        throw new RpcResolutionError("missing",
            `RPC "${def.name}" is declared, and the database has no function ${qualified}. Create it ` +
            "(`CREATE FUNCTION`), or fix the name or `schema` in its `defineRpc`. Postgres stores an unquoted " +
            "name in lower case.");
    }
    const takes = (candidate: RpcCandidate): boolean => {
        const inputs = inputParameters(candidate);
        const names = new Set(inputs.map(parameter => parameter.name));
        if (!sent.every(name => names.has(name))) return false;
        const withoutDefault = inputs.slice(0, inputs.length - candidate.defaultCount);
        return withoutDefault.every(parameter => parameter.name !== null && sent.includes(parameter.name));
    };
    const matching = candidates.filter(takes);
    if (matching.length === 1) return matching[0];
    if (matching.length === 0) {
        const signatures = candidates.map(candidate =>
            `(${inputParameters(candidate).map(parameter => parameter.name ?? "?").join(", ")})`).join(", ");
        throw new RpcResolutionError("no-match",
            `${qualified} cannot be called with the arguments (${sent.join(", ") || "none"}): it takes ${signatures}. ` +
            "Every parameter without a DEFAULT must be sent, and only named parameters can be.");
    }
    throw new RpcResolutionError("ambiguous",
        `${matching.length} overloads of ${qualified} take the arguments (${sent.join(", ") || "none"}), so the call ` +
        "has no single answer. Drop the overloads an RPC should not reach, or give them distinct names.");
}

/** `"name"`, with any `"` doubled. */
function quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, "\"\"")}"`;
}

/**
 * The statement that calls `candidate` with `args`, and its one parameter.
 * Only the arguments sent are passed, so an absent one takes the function's
 * own `DEFAULT`.
 */
export function buildRpcStatement(def: AnyRpcDef, candidate: RpcCandidate, args: Record<string, unknown>): { query: string; params: unknown[] } {
    const fn = `${quoteIdentifier(def.config.schema ?? "public")}.${quoteIdentifier(def.name)}`;
    const typeOf = new Map(inputParameters(candidate).flatMap(parameter => parameter.name ? [[parameter.name, parameter.type] as const] : []));
    const names = Object.keys(args).filter(name => typeOf.has(name));
    if (names.length === 0) return { query: `SELECT _r.* FROM ${fn}() AS _r`, params: [] };
    const columns = names.map(name => `${quoteIdentifier(name)} ${typeOf.get(name)}`).join(", ");
    const named = names.map(name => `${quoteIdentifier(name)} => _a.${quoteIdentifier(name)}`).join(", ");
    const values: Record<string, unknown> = {};
    for (const name of names) values[name] = args[name];
    return {
        query: `SELECT _r.* FROM json_to_record($1::json) AS _a(${columns}), ${fn}(${named}) AS _r`,
        params: [JSON.stringify(values)]
    };
}

/** The first column of a row: a single-value function's result. */
function valueOf(row: Record<string, unknown> | undefined): unknown {
    if (!row) return null;
    const [value] = Object.values(row);
    return value === undefined ? null : value;
}

/** What the call answers: see the module docs. */
export function shapeRpcResult(candidate: RpcCandidate, rows: Record<string, unknown>[]): unknown {
    if (candidate.returns === "void") return null;
    if (candidate.returnsSet) return candidate.returns === "row" ? rows : rows.map(valueOf);
    if (candidate.returns === "value") return valueOf(rows[0]);
    const row = rows[0];
    // A function returning one row answers `NULL` as a row of nulls.
    if (!row || Object.values(row).every(value => value === null)) return null;
    return row;
}

/** How long a function's catalogue entry is trusted before it is read again. */
export const RPC_SIGNATURE_TTL_MS = 60_000;

/**
 * The catalogue entries of the declared functions, read on first call and
 * kept for {@link RPC_SIGNATURE_TTL_MS}. A function dropped and recreated
 * with other parameters is read again on the first call that fails for it.
 */
export class RpcSignatureCache {
    private readonly entries = new Map<string, { at: number; candidates: Promise<RpcCandidate[]> }>();

    constructor(private readonly now: () => number = Date.now) {}

    candidates(def: AnyRpcDef, sql: RpcSqlRunner): Promise<RpcCandidate[]> {
        const key = `${def.config.schema ?? "public"}.${def.name}`;
        const cached = this.entries.get(key);
        if (cached && this.now() - cached.at < RPC_SIGNATURE_TTL_MS) return cached.candidates;
        const candidates = readCandidates(sql, def);
        this.entries.set(key, { at: this.now(), candidates });
        // A failed read is not kept: the next call reads again.
        candidates.catch(() => {
            if (this.entries.get(key)?.candidates === candidates) this.entries.delete(key);
        });
        return candidates;
    }

    /** Whether a call to `def` would be answered from the cache. */
    holds(def: AnyRpcDef): boolean {
        const cached = this.entries.get(`${def.config.schema ?? "public"}.${def.name}`);
        return cached !== undefined && this.now() - cached.at < RPC_SIGNATURE_TTL_MS;
    }

    forget(def: AnyRpcDef): void {
        this.entries.delete(`${def.config.schema ?? "public"}.${def.name}`);
    }
}
