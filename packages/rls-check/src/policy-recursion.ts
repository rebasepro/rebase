/**
 * Policies Postgres refuses to expand: `infinite recursion detected in policy
 * for relation "…"` (SQLSTATE 42P17).
 *
 * How the rewriter decides — `fireRIRrules` in
 * `src/backend/rewrite/rewriteHandler.c`. For each table a statement names, it
 * collects the policies that apply to the command and the current role. When
 * any of them contains a sub-select (a SubLink: `EXISTS (SELECT …)`,
 * `x IN (SELECT …)`, a scalar `(SELECT …)`), it raises 42P17 if that table is
 * already being expanded; otherwise it marks the table and expands the tables
 * those sub-selects read, as SELECTs, the same way. A table whose policies
 * contain no sub-select is neither checked nor walked into. A function call is
 * never expanded — its body is planned when it runs — which is why moving the
 * read into a `SECURITY DEFINER` function is the way out.
 *
 * So a statement on T fails when a policy it applies reads, in a sub-select, a
 * table from which SELECT policies lead back to T, every table on the way — T
 * included — having a sub-select among its SELECT policies. Since 0.25 Rebase
 * writes `rebase.uid()` as `(SELECT rebase.uid())`, and the admin baseline is a
 * sub-select too, so nearly every table's policies qualify: a rule that reads
 * its own table, or two tables whose rules read each other, fails on every such
 * statement — for signed-in users, the service key and `dataAsAdmin` alike.
 *
 * Pure, like the checks: policies in, recursions out. The policy text is read
 * with this package's scanner (`checks/sql.ts`), so a `FROM` inside a string
 * literal, a comment or `extract(… FROM …)` is never a table. What it cannot
 * see, it does not guess, so each of these is a miss and never a false error:
 *
 * - a view a policy reads (Postgres expands the view's query as well);
 * - a table the input carries no policies for;
 * - a table read inside a function — which is also what Postgres does not
 *   expand, so that one is not a miss at all;
 * - a policy written `TO` a role no {@link RoleContext} holds.
 *
 * A finding is `heuristic` rather than `certain` only when its loop passes
 * through a table named without a schema that the search path does not settle.
 */
import type { DbPolicy, PolicyCommand } from "./types";
import { matchParen, tokenize, type SqlToken } from "./checks/sql";

/** The parts of a policy the analysis reads: a {@link DbPolicy}, or a policy a compiler planned. */
export type RecursionPolicy = Pick<DbPolicy, "schema" | "table" | "name" | "roles" | "command" | "using" | "withCheck">;

/** A role requests run as, by the policy roles that apply to it. */
export interface RoleContext {
    /** How a finding names it: `rebase_user`, `rebase_user_admin`. */
    name: string;
    /**
     * The roles whose policies apply to it besides PUBLIC: itself and every
     * role it inherits. A policy applies when its `TO` list names PUBLIC or
     * one of these.
     */
    roles: readonly string[];
}

/** What {@link findPolicyRecursion} assumes about the database the policies live in. */
export interface PolicyRecursionOptions {
    /**
     * The roles requests run as. Each is walked on its own, because a policy
     * applies only to the roles its `TO` list reaches. Without any, only the
     * policies written `TO PUBLIC` are walked: they apply to every role.
     */
    contexts?: readonly RoleContext[];
    /**
     * Where a table named without a schema resolves, first match wins: the
     * search path the policies were created under. Defaults to `["public"]`,
     * the one Rebase pins on its connections.
     */
    searchPath?: readonly string[];
}

/** One table the rewriter expands, and the policy whose sub-select reads the next one. */
export interface RecursionStep {
    schema: string;
    table: string;
    policy: string;
}

/** A policy whose expansion Postgres refuses with 42P17. */
export interface PolicyRecursion {
    schema: string;
    table: string;
    /** The policy that starts the loop. */
    policy: string;
    command: PolicyCommand;
    /** The table the policy's sub-select reads, where the loop starts. */
    reads: { schema: string; table: string };
    /**
     * The expansion, in order: the policy's table first, then every table the
     * loop passes through, each with the policy that reads the next. The
     * table after the last step is {@link table} again, where Postgres finds
     * a table it is already expanding.
     */
    path: RecursionStep[];
    /** The {@link RoleContext} names it recurses for. */
    contexts: string[];
    /** `certain` unless the loop passes through a table name the search path does not settle. */
    confidence: "certain" | "heuristic";
    /** Why it is heuristic, one sentence each. Empty when certain. */
    caveats: string[];
}

/** A table a sub-select names, as written: schema-qualified or bare. */
export interface TableRef {
    schema: string | null;
    name: string;
}

/** What a policy expression's sub-selects amount to. */
export interface SubLinks {
    /** Whether the expression has any sub-select at all — what makes Postgres walk into the table. */
    hasSubLink: boolean;
    /** The tables named in a FROM or JOIN of any of them, CTE names left out. */
    reads: TableRef[];
}

/** The first word of a parenthesised sub-select. */
const SUBQUERY_OPENERS = new Set(["select", "with", "values"]);

/** Words that end a FROM list at its own level. */
const FROM_LIST_END = new Set([
    "where", "group", "having", "order", "limit", "offset", "union", "intersect", "except",
    "window", "fetch", "for", "select", "returning"
]);

/** Words that may precede a FROM item and are not its name. */
const FROM_ITEM_PREFIX = new Set(["only", "lateral"]);

const isWord = (token: SqlToken | undefined, words: ReadonlySet<string> | string): boolean =>
    token !== undefined && token.kind === "ident" && !token.quoted &&
    (typeof words === "string" ? token.value === words : words.has(token.value));

const isPunct = (token: SqlToken | undefined, value: string): boolean =>
    token !== undefined && token.kind === "punct" && token.value === value;

/**
 * The table a FROM item at `start` names, or null when it names none: a
 * derived table `(SELECT …)` (read as a sub-select of its own) or a function
 * (`FROM unnest(…)`), which Postgres does not expand.
 */
function fromItem(tokens: SqlToken[], start: number, end: number): TableRef | null {
    let j = start;
    while (j < end && isWord(tokens[j], FROM_ITEM_PREFIX)) j++;
    const parts: SqlToken[] = [];
    while (j < end && tokens[j].kind === "ident") {
        parts.push(tokens[j]);
        if (isPunct(tokens[j + 1], ".")) j += 2;
        else {
            j++;
            break;
        }
    }
    if (parts.length === 0) return null;
    if (j < end && isPunct(tokens[j], "(")) return null;
    return {
        schema: parts.length > 1 ? parts[parts.length - 2].value : null,
        name: parts[parts.length - 1].value
    };
}

/** The tables the FROM and JOIN clauses of one sub-select's own level name. */
function fromItems(tokens: SqlToken[], start: number, end: number, level: number): TableRef[] {
    const out: TableRef[] = [];
    const take = (at: number) => {
        const ref = fromItem(tokens, at, end);
        if (ref) out.push(ref);
    };
    let inFrom = false;
    for (let j = start; j < end; j++) {
        const token = tokens[j];
        if (token.depth !== level) continue;
        if (isWord(token, "from")) {
            // `a IS [NOT] DISTINCT FROM b` compares; it opens no FROM clause.
            if (isWord(tokens[j - 1], "distinct")) continue;
            inFrom = true;
            take(j + 1);
        } else if (isWord(token, "join")) {
            inFrom = true;
            take(j + 1);
        } else if (isWord(token, FROM_LIST_END)) {
            inFrom = false;
        } else if (inFrom && isPunct(token, ",")) {
            take(j + 1);
        }
    }
    return out;
}

/** The names `WITH name [(cols)] AS [[NOT] MATERIALIZED] (…)` defines anywhere in the expression. */
function cteNames(tokens: SqlToken[]): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].kind !== "ident") continue;
        let j = i + 1;
        if (isPunct(tokens[j], "(")) {
            const close = matchParen(tokens, j);
            if (close === -1) continue;
            j = close + 1;
        }
        if (!isWord(tokens[j], "as")) continue;
        let k = j + 1;
        if (isWord(tokens[k], "not")) k++;
        if (isWord(tokens[k], "materialized")) k++;
        if (isPunct(tokens[k], "(") && isWord(tokens[k + 1], SUBQUERY_OPENERS)) out.add(tokens[i].value);
    }
    return out;
}

/**
 * Every sub-select in a policy expression: whether there is one, and the
 * tables they read.
 *
 * Sub-selects nest, and each is read at its own level, so `FROM` inside
 * `extract(year FROM x)` — one level deeper than the sub-select it sits in —
 * is never a FROM clause.
 */
export function readSubLinks(expr: string | null | undefined): SubLinks {
    if (!expr) return { hasSubLink: false, reads: [] };
    const tokens = tokenize(expr);
    const reads: TableRef[] = [];
    let hasSubLink = false;
    for (let i = 0; i < tokens.length; i++) {
        if (!isPunct(tokens[i], "(") || !isWord(tokens[i + 1], SUBQUERY_OPENERS)) continue;
        hasSubLink = true;
        const close = matchParen(tokens, i);
        reads.push(...fromItems(tokens, i + 1, close === -1 ? tokens.length : close, tokens[i].depth + 1));
    }
    const ctes = cteNames(tokens);
    return { hasSubLink, reads: reads.filter(ref => ref.schema !== null || !ctes.has(ref.name)) };
}

/** An edge of the read graph: a sub-select of one table's policy reads `to`. */
interface Edge {
    to: string;
    certain: boolean;
    caveat?: string;
}

/**
 * One policy, read. Its clauses are kept apart because Postgres walks them
 * apart: expanding a table for a sub-select applies only USING, while whether
 * it walks into the table at all is decided per policy, from either clause.
 */
interface ParsedPolicy {
    policy: RecursionPolicy;
    key: string;
    /** Either clause has a sub-select: `pg_policy`'s `hassublinks`, as the rewriter reads it. */
    hasSubLink: boolean;
    usingEdges: Edge[];
    checkEdges: Edge[];
}

/**
 * The edges a statement of the policy's own command walks: USING for a read
 * or a delete, WITH CHECK (or USING standing in for it) for an insert, both
 * for an update — and both for `ALL`, which an update applies whole.
 */
function startEdges(entry: ParsedPolicy): Edge[] {
    switch (entry.policy.command) {
        case "SELECT":
        case "DELETE":
            return entry.usingEdges;
        case "INSERT":
            return entry.policy.withCheck != null ? entry.checkEdges : entry.usingEdges;
        default:
            return uniqueEdges([...entry.usingEdges, ...entry.checkEdges]);
    }
}

/** One edge per table, the certain one when a table is reached both ways. */
function uniqueEdges(edges: readonly Edge[]): Edge[] {
    const byTable = new Map<string, Edge>();
    for (const edge of edges) {
        const known = byTable.get(edge.to);
        if (!known || (edge.certain && !known.certain)) byTable.set(edge.to, edge);
    }
    return [...byTable.values()];
}

/** A NUL cannot appear in a Postgres identifier, so it cannot make two pairs collide. */
const keyOf = (schema: string, table: string): string => `${schema}\u0000${table}`;

function splitKey(key: string): { schema: string; table: string } {
    const at = key.indexOf("\u0000");
    return { schema: key.slice(0, at), table: key.slice(at + 1) };
}

/** The policy tables a reference can mean. */
function resolve(ref: TableRef, schemasByTable: ReadonlyMap<string, string[]>, searchPath: readonly string[]): Edge[] {
    const schemas = schemasByTable.get(ref.name) ?? [];
    if (ref.schema !== null) return schemas.includes(ref.schema) ? [{ to: keyOf(ref.schema, ref.name), certain: true }] : [];
    const onPath = searchPath.find(schema => schemas.includes(schema));
    if (onPath !== undefined) return [{ to: keyOf(onPath, ref.name), certain: true }];
    return schemas.map(schema => ({
        to: keyOf(schema, ref.name),
        certain: false,
        caveat: `"${ref.name}" is written without a schema and the search path (${searchPath.join(", ")}) has no table of that name: ` +
            `it is ${schema}.${ref.name} only if the policy was created with ${schema} on its search path.`
    }));
}

const appliesIn = (policy: RecursionPolicy, roles: ReadonlySet<string>): boolean =>
    policy.roles.some(role => role.toLowerCase() === "public" || roles.has(role.toLowerCase()));

/** What expanding a table as a sub-select's SELECT brings in, for one role. */
interface ReadExpansion {
    /** Whether any of its SELECT policies has a sub-select — what makes Postgres check and walk into it. */
    hasSubLink: boolean;
    edges: { edge: Edge; policy: string }[];
}

/** A way from a policy's sub-select back to its own table. */
interface Loop {
    via: { key: string; policy: string }[];
    caveats: string[];
}

/**
 * The shortest way from `first` back to `home` through tables whose SELECT
 * policies have a sub-select — the tables Postgres walks into — or null.
 * `certainOnly` keeps to edges whose table is not in doubt.
 */
function loopBack(home: string, first: Edge, expand: (key: string) => ReadExpansion, certainOnly: boolean): Loop | null {
    if (certainOnly && !first.certain) return null;
    const queue: { key: string; via: Loop["via"]; caveats: string[] }[] = [
        { key: first.to, via: [], caveats: first.caveat ? [first.caveat] : [] }
    ];
    const seen = new Set<string>();
    for (let next = queue.shift(); next; next = queue.shift()) {
        const expansion = expand(next.key);
        // No sub-select among its policies: Postgres neither checks this table nor walks past it.
        if (!expansion.hasSubLink) continue;
        if (next.key === home) return { via: next.via, caveats: next.caveats };
        if (seen.has(next.key)) continue;
        seen.add(next.key);
        for (const { edge, policy } of expansion.edges) {
            if (certainOnly && !edge.certain) continue;
            queue.push({
                key: edge.to,
                via: [...next.via, { key: next.key, policy }],
                caveats: edge.caveat ? [...next.caveats, edge.caveat] : next.caveats
            });
        }
    }
    return null;
}

/**
 * Every policy whose sub-selects lead back to its own table through tables
 * Postgres walks into — each one a statement the database refuses with 42P17.
 *
 * One finding per policy and table it reads, with the shortest loop and every
 * role context it recurses for. A loop between two other tables that a policy
 * merely passes through is reported from those tables' own policies, not
 * again from every policy that reaches it.
 */
export function findPolicyRecursion(
    policies: readonly RecursionPolicy[],
    options: PolicyRecursionOptions = {}
): PolicyRecursion[] {
    const searchPath = options.searchPath ?? ["public"];
    const contexts: readonly RoleContext[] = options.contexts && options.contexts.length > 0
        ? options.contexts
        : [{ name: "PUBLIC", roles: [] }];

    const schemasByTable = new Map<string, string[]>();
    for (const policy of policies) {
        const schemas = schemasByTable.get(policy.table) ?? [];
        if (!schemas.includes(policy.schema)) schemas.push(policy.schema);
        schemasByTable.set(policy.table, schemas);
    }

    const edgesOf = (refs: readonly TableRef[]): Edge[] =>
        uniqueEdges(refs.flatMap(ref => resolve(ref, schemasByTable, searchPath)));
    const parsed: ParsedPolicy[] = policies.map(policy => {
        const using = readSubLinks(policy.using);
        const check = readSubLinks(policy.withCheck);
        return {
            policy,
            key: keyOf(policy.schema, policy.table),
            hasSubLink: using.hasSubLink || check.hasSubLink,
            usingEdges: edgesOf(using.reads),
            checkEdges: edgesOf(check.reads)
        };
    });
    const byTable = new Map<string, ParsedPolicy[]>();
    for (const entry of parsed) byTable.set(entry.key, [...(byTable.get(entry.key) ?? []), entry]);

    const found = new Map<string, PolicyRecursion>();
    for (const context of contexts) {
        const roles = new Set(context.roles.map(role => role.toLowerCase()));
        const expansions = new Map<string, ReadExpansion>();
        const expand = (key: string): ReadExpansion => {
            const known = expansions.get(key);
            if (known) return known;
            // A read applies the USING clause of each SELECT and ALL policy; an
            // ALL policy with only a WITH CHECK takes no part in it at all.
            const reading = (byTable.get(key) ?? []).filter(entry =>
                (entry.policy.command === "SELECT" || entry.policy.command === "ALL") &&
                entry.policy.using != null && appliesIn(entry.policy, roles));
            const expansion: ReadExpansion = {
                hasSubLink: reading.some(entry => entry.hasSubLink),
                edges: reading.flatMap(entry => entry.usingEdges.map(edge => ({ edge, policy: entry.policy.name })))
            };
            expansions.set(key, expansion);
            return expansion;
        };

        for (const start of parsed) {
            if (!appliesIn(start.policy, roles)) continue;
            for (const first of startEdges(start)) {
                const certain = loopBack(start.key, first, expand, true);
                const loop = certain ?? loopBack(start.key, first, expand, false);
                if (!loop) continue;
                const id = `${start.key}\u0000${start.policy.name}\u0000${first.to}`;
                const path: RecursionStep[] = [
                    { schema: start.policy.schema, table: start.policy.table, policy: start.policy.name },
                    ...loop.via.map(step => ({ ...splitKey(step.key), policy: step.policy }))
                ];
                const known = found.get(id);
                if (known) {
                    if (!known.contexts.includes(context.name)) known.contexts.push(context.name);
                    if (certain && known.confidence === "heuristic") {
                        known.path = path;
                        known.confidence = "certain";
                        known.caveats = [];
                    }
                    continue;
                }
                found.set(id, {
                    schema: start.policy.schema,
                    table: start.policy.table,
                    policy: start.policy.name,
                    command: start.policy.command,
                    reads: splitKey(first.to),
                    path,
                    contexts: [context.name],
                    confidence: certain ? "certain" : "heuristic",
                    caveats: certain ? [] : [...new Set(loop.caveats)]
                });
            }
        }
    }

    return [...found.values()].sort((a, b) =>
        a.schema.localeCompare(b.schema) ||
        a.table.localeCompare(b.table) ||
        a.policy.localeCompare(b.policy) ||
        a.reads.schema.localeCompare(b.reads.schema) ||
        a.reads.table.localeCompare(b.reads.table));
}
