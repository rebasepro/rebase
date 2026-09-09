import { MAX_INCLUDE_DEPTH } from "@rebasepro/types";
import type { FilterValues, IncludeOptions, IncludeSpec, LogicalCondition, OrderByTuple } from "@rebasepro/types";
import { deserializeOrderByList, normalizeOrderBy } from "./sort-dialect";

/**
 * The `include` codec: one shape, whatever spelling it arrived in.
 *
 * `include` reaches the driver by four routes — the REST `?include=` parameter,
 * a WebSocket subscribe frame, the SDK's `include(...)`, and the admin panel's
 * "all relations" — and each used to hand the driver something slightly
 * different. This normalises all four to one tree, so the fetch pipeline has a
 * single thing to read and `find()`, `findById()` and `listen()` cannot disagree
 * about what "include the author" means.
 *
 * @module
 */

/**
 * One relation to load, and how.
 *
 * `children` is the nesting: `comments.author` is a `comments` node with an
 * `author` child. Every other field narrows the rows *of this relation* — the
 * same knobs a top-level query has, which is the point.
 */
export interface IncludeNode {
    /** Rows to load per parent row. */
    limit?: number;
    /** Filter over the related rows. */
    where?: FilterValues<string>;
    /** An `and`/`or`/`not` group over the related rows. */
    logical?: LogicalCondition;
    /** Sort for the related rows. */
    orderBy?: OrderByTuple[];
    /** Columns of the related row to return. */
    fields?: string[];
    /** Relations of the related row, loaded in turn. */
    children: Record<string, IncludeNode>;
}

/**
 * A whole `include` request: the tree, plus whether the caller asked for
 * *every* relation.
 *
 * The wildcard is kept as a flag rather than expanded into names here, because
 * expanding it needs the collection — which this package does not have. The
 * driver expands it against the relations it actually resolved.
 */
export interface NormalizedInclude {
    /** `include=*` — every relation of the collection, one hop deep. */
    wildcard: boolean;
    /** The named relations. Empty when `wildcard` is set alone. */
    tree: Record<string, IncludeNode>;
}

/** An `include` that cannot be read, as opposed to one naming a relation that does not exist. */
export class IncludeSpecError extends Error {
    readonly code: string;
    constructor(detail: string, code = "INVALID_INCLUDE") {
        super(`Invalid \`include\`: ${detail}`);
        this.name = "IncludeSpecError";
        this.code = code;
        Object.setPrototypeOf(this, IncludeSpecError.prototype);
    }
}

const emptyNode = (): IncludeNode => ({ children: {} });

function ensureNode(tree: Record<string, IncludeNode>, key: string): IncludeNode {
    return (tree[key] ??= emptyNode());
}

/**
 * Merge one dotted path (`"comments.author"`) into a tree.
 *
 * Merging rather than assigning is what makes `include=comments,comments.author`
 * mean the same thing as `include=comments.author`: the second path deepens the
 * node the first created instead of replacing it and losing its options.
 */
function addPath(tree: Record<string, IncludeNode>, path: string): void {
    const segments = path.split(".").map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) return;
    if (segments.length > MAX_INCLUDE_DEPTH) {
        throw new IncludeSpecError(
            `"${path}" nests ${segments.length} relations deep; the limit is ${MAX_INCLUDE_DEPTH}. ` +
            "Each hop is another query, and an unbounded one walks a self-referencing relation forever.",
            "INCLUDE_TOO_DEEP"
        );
    }
    let level = tree;
    for (const segment of segments) {
        level = ensureNode(level, segment).children;
    }
}

function normalizeOptions(key: string, options: IncludeOptions, depth: number): IncludeNode {
    if (depth > MAX_INCLUDE_DEPTH) {
        throw new IncludeSpecError(
            `"${key}" nests more than ${MAX_INCLUDE_DEPTH} relations deep.`,
            "INCLUDE_TOO_DEEP"
        );
    }
    if (options.limit !== undefined
        && (!Number.isInteger(options.limit) || options.limit < 1)) {
        throw new IncludeSpecError(
            `"${key}" has limit ${JSON.stringify(options.limit)} — expected a whole number of 1 or more.`
        );
    }
    const node: IncludeNode = { children: {} };
    if (options.limit !== undefined) node.limit = options.limit;
    if (options.where) node.where = options.where;
    if (options.logical) node.logical = options.logical;
    if (options.fields && options.fields.length > 0) node.fields = [...options.fields];
    // The same two spellings the top-level `?orderBy=` accepts: the
    // `field:direction[:nulls]` shorthand a caller writes into a query string,
    // and the tuple form a typed caller writes in code. Accepting only the
    // tuples made the JSON include form — the one that exists *because* it
    // travels over a query string — unable to express the shorthand beside it.
    const orderBy = typeof options.orderBy === "string"
        ? deserializeOrderByList(options.orderBy)
        : normalizeOrderBy(options.orderBy);
    if (orderBy) node.orderBy = orderBy;
    if (options.include) {
        const nested = normalizeIncludeAt(options.include, depth + 1);
        if (nested.wildcard) {
            // `*` inside a nested include has no bound: it would load every
            // relation of every related row, of every related row. The outer
            // wildcard is already the widest thing this API offers.
            throw new IncludeSpecError(
                `"${key}" asks for \`*\` inside a nested include. Name the relations you need.`
            );
        }
        node.children = nested.tree;
    }
    return node;
}

function normalizeIncludeAt(spec: IncludeSpec, depth: number): NormalizedInclude {
    if (Array.isArray(spec)) {
        const tree: Record<string, IncludeNode> = {};
        let wildcard = false;
        for (const raw of spec) {
            if (typeof raw !== "string") {
                throw new IncludeSpecError(`${typeof raw} is not a relation name`);
            }
            const name = raw.trim();
            if (!name) continue;
            if (name === "*") { wildcard = true; continue; }
            addPath(tree, name);
        }
        return { wildcard, tree };
    }
    if (typeof spec !== "object" || spec === null) {
        throw new IncludeSpecError(`${typeof spec} is not a list of relations or an include tree`);
    }

    const tree: Record<string, IncludeNode> = {};
    let wildcard = false;
    for (const [key, value] of Object.entries(spec)) {
        if (key === "*") {
            if (value) wildcard = true;
            continue;
        }
        if (value === true) { ensureNode(tree, key); continue; }
        // `false`/`null` are not in `IncludeSpec`, but this reads values that
        // arrived as JSON off a query string, where they are exactly what a
        // caller writes to turn one relation off in a tree they built by
        // spreading another. Skipping is what they mean.
        if ((value as unknown) === false || value === undefined || value === null) continue;
        if (typeof value !== "object" || Array.isArray(value)) {
            throw new IncludeSpecError(`"${key}" must be \`true\` or an options object`);
        }
        tree[key] = normalizeOptions(key, value as IncludeOptions, depth);
    }
    return { wildcard, tree };
}

/**
 * Collapse any {@link IncludeSpec} spelling into one tree.
 *
 * `["author", "comments.author"]` and
 * `{ author: true, comments: { include: { author: true } } }` normalize to the
 * same value — which is the whole point: the REST parameter can only carry the
 * flat spelling, the SDK prefers the tree, and the driver should never learn
 * about either.
 *
 * @throws {IncludeSpecError} for a shape that is not an include at all, or one
 *   that nests past {@link MAX_INCLUDE_DEPTH}.
 */
export function normalizeInclude(spec?: IncludeSpec): NormalizedInclude | undefined {
    if (spec === undefined || spec === null) return undefined;
    const normalized = normalizeIncludeAt(spec, 1);
    if (!normalized.wildcard && Object.keys(normalized.tree).length === 0) return undefined;
    return normalized;
}

/**
 * Every relation name a tree names, as dotted paths — `["comments",
 * "comments.author"]`.
 *
 * Used to report which names an `include` asked for when one of them is not a
 * relation, and to serialize a tree that carries no per-relation options back
 * to the flat wire spelling.
 */
export function includePaths(tree: Record<string, IncludeNode>, prefix = ""): string[] {
    const out: string[] = [];
    for (const [key, node] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        out.push(path);
        out.push(...includePaths(node.children, path));
    }
    return out;
}

/**
 * The relation names an `include` asks for at the top level.
 *
 * `["author", "comments.author"]` and `{author: true, comments: {...}}` both
 * answer `["author", "comments"]` — a *hop*, not a path, because the only
 * consumer is `?fields=`, which names keys on the row being returned and a
 * nested relation is not one of those.
 *
 * Derived rather than passed: `include` has four spellings and three of them
 * are not a `string[]`, so every consumer that wants the plain names either
 * calls this or reimplements the flattening.
 */
export function topLevelIncludeNames(spec?: IncludeSpec): string[] {
    const normalized = normalizeInclude(spec);
    if (!normalized) return [];
    return Object.keys(normalized.tree);
}

/** Whether any node in the tree carries per-relation options. */
function hasOptions(tree: Record<string, IncludeNode>): boolean {
    return Object.values(tree).some(node =>
        node.limit !== undefined || node.where !== undefined || node.logical !== undefined
        || node.orderBy !== undefined || node.fields !== undefined
        || hasOptions(node.children));
}

/**
 * Serialize an {@link IncludeSpec} for the REST `?include=` parameter.
 *
 * Two spellings, and which one is used is decided by the request rather than
 * chosen:
 *
 * - **Comma-separated dotted paths** — `include=author,comments.author`. What a
 *   plain include is, what a human types, and what every existing client sends.
 * - **JSON**, when any relation carries options — `include={"comments":{"limit":5,
 *   "include":{"author":true}}}`. The flat spelling has nowhere to put a
 *   `limit`, and inventing a punctuation for it (`comments(limit:5)`) would be a
 *   third grammar to learn beside the two this API already has.
 *
 * The server accepts both on every list and get route, and tells them apart the
 * same way this does: a value starting with `{` is JSON.
 */
export function serializeInclude(spec?: IncludeSpec): string | undefined {
    const normalized = normalizeInclude(spec);
    if (!normalized) return undefined;
    if (normalized.wildcard && Object.keys(normalized.tree).length === 0) return "*";
    if (!hasOptions(normalized.tree)) {
        const paths = includePaths(normalized.tree);
        // Only the leaves: `comments.author` already implies `comments`, and
        // sending both is the same request twice.
        const leaves = paths.filter(path => !paths.some(other => other.startsWith(`${path}.`)));
        const all = normalized.wildcard ? ["*", ...leaves] : leaves;
        return all.length > 0 ? all.join(",") : undefined;
    }
    return JSON.stringify(toWireTree(normalized));
}

/**
 * A normalized tree, back in the {@link IncludeSpec} spelling a caller writes.
 *
 * The round trip is what lets a builder accumulate `include` calls: normalize
 * each, merge, and hand the result back as a spec the next layer can normalize
 * again. Idempotent, so doing it twice changes nothing.
 */
export function denormalizeInclude(normalized: NormalizedInclude): IncludeSpec {
    return toWireTree(normalized) as IncludeSpec;
}

function mergeTrees(
    into: Record<string, IncludeNode>,
    from: Record<string, IncludeNode>
): Record<string, IncludeNode> {
    for (const [key, node] of Object.entries(from)) {
        const existing = into[key];
        if (!existing) { into[key] = node; continue; }
        // The later call wins on each option it names, and says nothing about
        // the ones it does not — so `.include("comments")` after
        // `.include({comments:{limit:5}})` keeps the limit rather than erasing
        // it, which is the behaviour that makes accumulating calls safe.
        if (node.limit !== undefined) existing.limit = node.limit;
        if (node.where !== undefined) existing.where = node.where;
        if (node.logical !== undefined) existing.logical = node.logical;
        if (node.orderBy !== undefined) existing.orderBy = node.orderBy;
        if (node.fields !== undefined) existing.fields = node.fields;
        existing.children = mergeTrees(existing.children, node.children);
    }
    return into;
}

/**
 * Combine several `include` requests into one.
 *
 * Repeated `.include(...)` calls on a query builder are additive: each names
 * more of the graph to load, and a later one must not discard what an earlier
 * one asked for. Assigning instead of merging is why `.include("author")
 * .include("tags")` used to load only tags.
 */
export function mergeIncludeSpecs(
    existing: IncludeSpec | undefined,
    additions: (string | IncludeSpec)[]
): IncludeSpec | undefined {
    const merged: NormalizedInclude = { wildcard: false, tree: {} };
    const absorb = (spec?: IncludeSpec) => {
        const normalized = normalizeInclude(spec);
        if (!normalized) return;
        merged.wildcard ||= normalized.wildcard;
        mergeTrees(merged.tree, normalized.tree);
    };
    absorb(existing);
    // A bare string is one relation name; anything else is a spec in its own
    // right. `.include("a", "b")` and `.include(["a","b"])` are the same call.
    const names = additions.filter((a): a is string => typeof a === "string");
    if (names.length > 0) absorb(names);
    for (const addition of additions) {
        if (typeof addition !== "string") absorb(addition);
    }
    if (!merged.wildcard && Object.keys(merged.tree).length === 0) return undefined;
    return denormalizeInclude(merged);
}

function toWireTree(normalized: NormalizedInclude): Record<string, unknown> {
    const emit = (tree: Record<string, IncludeNode>): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [key, node] of Object.entries(tree)) {
            const options: Record<string, unknown> = {};
            if (node.limit !== undefined) options.limit = node.limit;
            if (node.where) options.where = node.where;
            if (node.logical) options.logical = node.logical;
            if (node.orderBy) options.orderBy = node.orderBy;
            if (node.fields) options.fields = node.fields;
            const children = emit(node.children);
            if (Object.keys(children).length > 0) options.include = children;
            out[key] = Object.keys(options).length > 0 ? options : true;
        }
        return out;
    };
    const tree = emit(normalized.tree);
    if (normalized.wildcard) tree["*"] = true;
    return tree;
}

/**
 * Read the REST `?include=` parameter, in either spelling.
 *
 * @throws {IncludeSpecError} for malformed JSON or a tree that nests too deep.
 */
export function deserializeInclude(raw?: string): IncludeSpec | undefined {
    if (raw === undefined || raw === null) return undefined;
    const text = raw.trim();
    if (!text) return undefined;
    if (text.startsWith("{")) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new IncludeSpecError(
                "the parametrised form must be a JSON object, e.g. "
                + "{\"comments\":{\"limit\":5,\"include\":{\"author\":true}}}"
            );
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new IncludeSpecError("the parametrised form must be a JSON object");
        }
        return parsed as IncludeSpec;
    }
    return text.split(",").map(s => s.trim()).filter(Boolean);
}
