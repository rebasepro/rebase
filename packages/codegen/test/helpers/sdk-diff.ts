import type { ColumnDescriptor, TableDescriptor } from "@rebasepro/types";

/**
 * Line-level comparison of two generated `database.types.ts` files, and the
 * allow-list the descriptor generator is held to against the goldens recorded
 * from the collection generator.
 *
 * A file is read as tables → blocks (`Row`, `Insert`, `Update`, `Relations`,
 * `Slug`) → one line per key, plus everything after `Database` verbatim. Each
 * difference is one key of one block of one table: added, removed, changed, or
 * the block's keys in another order. A difference is allowed only when a rule
 * of {@link SDK_ALLOWED_DIFFERENCES} explains it from the descriptor of the
 * table it is in — a rule is a reason the bytes cannot be the same, never a
 * list of lines.
 */

/** One difference between the golden and the generated file. */
export interface SdkDifference {
    /** The table's accessor, or `(file)` for the part after `Database`. */
    table: string;
    block: string;
    /** The key the line is for; absent for an order difference. */
    key?: string;
    kind: "added" | "removed" | "changed" | "order";
    golden?: string;
    generated?: string;
}

type Blocks = Map<string, Map<string, string>>;

interface ParsedFile {
    tables: Map<string, Blocks>;
    tableOrder: string[];
    trailer: string;
}

const KEY_LINE = /^ {6}("(?:[^"\\]|\\.)*"|[^?:]+)\??: /;

function keyOf(line: string): string {
    const match = KEY_LINE.exec(line);
    if (!match) return line.trim();
    const raw = match[1];
    return raw.startsWith("\"") ? String(JSON.parse(raw)) : raw;
}

function parse(source: string): ParsedFile {
    const lines = source.split("\n");
    const tables = new Map<string, Blocks>();
    const tableOrder: string[] = [];
    let index = lines.indexOf("export interface Database {") + 1;
    if (index === 0) return { tables, tableOrder, trailer: source };
    let table: Blocks | undefined;
    let block: Map<string, string> | undefined;
    for (; index < lines.length; index++) {
        const line = lines[index];
        if (line === "}") {
            index++;
            break;
        }
        const tableMatch = /^ {2}(\S.*): \{$/.exec(line);
        if (tableMatch) {
            table = new Map();
            const name = tableMatch[1].startsWith("\"") ? String(JSON.parse(tableMatch[1])) : tableMatch[1];
            tables.set(name, table);
            tableOrder.push(name);
            continue;
        }
        if (line === "  };") continue;
        const single = /^ {4}(\w+): (.*);$/.exec(line);
        if (single && table) {
            table.set(single[1], new Map([["=", single[2]]]));
            block = undefined;
            continue;
        }
        const open = /^ {4}(\w+): \{$/.exec(line);
        if (open && table) {
            block = new Map();
            table.set(open[1], block);
            continue;
        }
        if (line.startsWith("    }") && block) {
            const rest = line.slice("    }".length);
            if (rest !== ";") block.set("&", rest);
            block = undefined;
            continue;
        }
        if (block) block.set(keyOf(line), line);
    }
    return { tables, tableOrder, trailer: lines.slice(index).join("\n") };
}

/**
 * Every difference between two generated files, one per key of one block.
 */
export function compareSdk(golden: string, generated: string): SdkDifference[] {
    const a = parse(golden);
    const b = parse(generated);
    const out: SdkDifference[] = [];
    if (a.tableOrder.join("\n") !== b.tableOrder.join("\n")) {
        out.push({ table: "(file)", block: "tables", kind: "order", golden: a.tableOrder.join(", "), generated: b.tableOrder.join(", ") });
    }
    for (const name of new Set([...a.tableOrder, ...b.tableOrder])) {
        const blocksA = a.tables.get(name) ?? new Map<string, Map<string, string>>();
        const blocksB = b.tables.get(name) ?? new Map<string, Map<string, string>>();
        for (const blockName of new Set([...blocksA.keys(), ...blocksB.keys()])) {
            const linesA = blocksA.get(blockName) ?? new Map<string, string>();
            const linesB = blocksB.get(blockName) ?? new Map<string, string>();
            for (const [key, line] of linesA) {
                const other = linesB.get(key);
                if (other === undefined) out.push({ table: name, block: blockName, key, kind: "removed", golden: line });
                else if (other !== line) out.push({ table: name, block: blockName, key, kind: "changed", golden: line, generated: other });
            }
            for (const [key, line] of linesB) {
                if (!linesA.has(key)) out.push({ table: name, block: blockName, key, kind: "added", generated: line });
            }
            const common = [...linesA.keys()].filter(key => linesB.has(key));
            const commonB = [...linesB.keys()].filter(key => linesA.has(key));
            if (common.join("\n") !== commonB.join("\n")) {
                out.push({ table: name, block: blockName, kind: "order", golden: common.join(", "), generated: commonB.join(", ") });
            }
        }
    }
    if (a.trailer !== b.trailer) out.push({ table: "(file)", block: "trailer", kind: "changed", golden: a.trailer, generated: b.trailer });
    return out;
}

/** What a rule reads to decide whether it explains a difference. */
export interface RuleContext {
    /** The descriptor of the table the difference is in, by accessor. */
    table: TableDescriptor | undefined;
    column: ColumnDescriptor | undefined;
}

/** A principled reason the descriptor generator's bytes differ from the collection generator's. */
export interface AllowedDifference {
    id: string;
    reason: string;
    explains(difference: SdkDifference, context: RuleContext): boolean;
}

const strip = (line: string | undefined): string => (line ?? "").replace(/^ {6}/, "");
const isOptionalLine = (line: string | undefined): boolean => /^ {6}(?:"(?:[^"\\]|\\.)*"|[^?:]+)\?: /.test(line ?? "");
/** The same line but for the `?` after the key. */
const sameButOptionality = (golden: string | undefined, generated: string | undefined): boolean =>
    strip(golden).replace(/^((?:"(?:[^"\\]|\\.)*"|[^?:]+))\?:/, "$1:") === strip(generated).replace(/^((?:"(?:[^"\\]|\\.)*"|[^?:]+))\?:/, "$1:");
const isImplicitKey = (column: ColumnDescriptor | undefined): boolean =>
    column !== undefined && column.key === "id" && column.primaryKey === true && column.type.kind === "text"
    && column.default?.kind === "sql" && column.default.expression === "gen_random_uuid()::text";
const hasOneOfShape = (column: ColumnDescriptor | undefined): boolean => {
    const walk = (shape: unknown): boolean => {
        if (typeof shape !== "object" || shape === null) return false;
        if ("kind" in shape && shape.kind === "oneOf") return true;
        return Object.values(shape).some(walk);
    };
    return walk(column?.json);
};

/** The `belongsTo` relations the lift renamed `<key>Relation`, by the column they left the key to. */
const renamedRelations = (table: TableDescriptor | undefined): Map<string, string> => {
    const out = new Map<string, string>();
    for (const relation of table?.relations ?? []) {
        if (relation.kind === "belongsTo" && relation.name === `${relation.localField}Relation`) out.set(relation.localField, relation.name);
    }
    return out;
};
/** Removing nullability and optionality, two lines read the same. */
const sameButNullability = (golden: string | undefined, generated: string | undefined): boolean => {
    const plain = (line: string | undefined): string => strip(line).replace(/ \| null/g, "").replace(/^((?:"(?:[^"\\]|\\.)*"|[^?:]+))\?:/, "$1:");
    return plain(golden) === plain(generated);
};
/** The order of `generated` is the golden's once `moved` keys are left out of both. */
const sameOrderWithout = (difference: SdkDifference, moved: ReadonlySet<string>): boolean => {
    const keep = (list: string | undefined): string => (list ?? "").split(", ").filter(key => !moved.has(key)).join(", ");
    return keep(difference.golden) === keep(difference.generated);
};

/**
 * Why a generated line may differ from its golden — each rule a fact the
 * descriptor states and the collection generator did not read. Kept as small
 * as the table model allows; every one is reported to the coordinator.
 */
export const SDK_ALLOWED_DIFFERENCES: AllowedDifference[] = [
    {
        id: "implicit-key",
        reason: "A collection that declared no key was planned with the implicit `id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text` " +
            "and served it, but the collection generator typed no `id`. The table model writes that column in `columns`, so `Row` " +
            "has `id: string` and `Insert` an optional `id?: string`.",
        explains: (d, c) => d.kind === "added" && (d.block === "Row" || d.block === "Insert") && isImplicitKey(c.column)
    },
    {
        id: "manual-key-required",
        reason: "A key the caller supplies (`isId: true` / `\"manual\"`) without `validation.required` was optional on `Insert`, though " +
            "the database refuses a row without it. A primary key is NOT NULL with no default, so a create must name it.",
        explains: (d, c) => d.kind === "changed" && d.block === "Insert" && c.column?.primaryKey === true
            && c.column.default === undefined && isOptionalLine(d.golden) && !isOptionalLine(d.generated)
            && sameButOptionality(d.golden, d.generated)
    },
    {
        id: "filled-column-optional",
        reason: "A NOT NULL column the server fills — a `defaultValue` (now a DEFAULT) or an `autoValue` stamp — was required on " +
            "`Insert`. A column with a default or a stamp may be left out of a create, as `InferInsert` says too.",
        explains: (d, c) => d.kind === "changed" && d.block === "Insert" && c.column !== undefined && !c.column.nullable
            && (c.column.default !== undefined || c.column.stamp !== undefined)
            && !isOptionalLine(d.golden) && isOptionalLine(d.generated) && sameButOptionality(d.golden, d.generated)
    },
    {
        id: "typed-blocks",
        reason: "An array of typed blocks (`oneOf`) was typed `Array<unknown>`. Its JSON shape (`json.oneOf`) types each block as " +
            "`{ type: \"<variant>\"; value: … }`.",
        explains: (d, c) => d.kind === "changed" && hasOneOfShape(c.column) && (d.golden ?? "").includes("unknown")
    },
    {
        id: "open-object",
        reason: "A map with `properties: {}` was typed `{  }` — TypeScript's `{}`, which admits any non-null value, a string " +
            "included. Its shape (an object with no declared field, open to any key) is a `Record<string, unknown>`.",
        explains: (d, c) => d.kind === "changed" && c.column?.json?.kind === "object"
            && Object.keys(c.column.json.fields).length === 0
            && strip(d.golden).replace("{  }", "Record<string, unknown>") === strip(d.generated)
    },
    {
        id: "renamed-relation",
        reason: "A `reference` (a foreign key with no relation), or a `belongsTo` served under its own column's key, lifts to the " +
            "column plus a `rel.belongsTo` named `<key>Relation` (a column and a relation cannot share a key). The column keeps " +
            "the key and is typed as the target's key and by its own nullability, no longer also as the included row; the " +
            "relation is reachable — included, listed in `Relations`, written by name — as `<key>Relation`.",
        explains: (d, c) => {
            const renamed = renamedRelations(c.table);
            if (renamed.size === 0) return false;
            const names = new Set(renamed.values());
            if (d.kind === "order") return sameOrderWithout(d, new Set([...renamed.keys(), ...names]));
            if (d.key === undefined) return false;
            if (names.has(d.key) || renamed.has(d.key)) return true;
            if (d.block === "Relations" && d.key === "=" && d.kind === "removed") return true;
            if (d.key === "&") return [...names].some(name => (d.generated ?? "").includes(`{ ${name}:`));
            return false;
        }
    },
    {
        id: "tenant-not-null",
        reason: "The planner makes a tenant column NOT NULL whatever it was declared, and the descriptor says so; the collection " +
            "generator read only `validation.required`, so it typed the column nullable and optional on a create.",
        explains: (d, c) => {
            const field = c.table?.tenant?.field;
            if (field === undefined) return false;
            if (d.key === field) return d.kind === "changed" && sameButNullability(d.golden, d.generated);
            const link = c.table?.relations.find(relation => relation.kind === "belongsTo" && relation.localField === field);
            if (d.key === "&") return (d.generated ?? "").includes(`{ ${field}:`) && (d.golden ?? "") !== (d.generated ?? "");
            return link !== undefined && d.key === link.name && d.kind === "changed" && sameButNullability(d.golden, d.generated);
        }
    },
    {
        id: "view-read-only",
        reason: "A view is never written — the server refuses a create, an update and a delete on one — so its `Insert` and " +
            "`Update` are `never` instead of a table's write shapes.",
        explains: (d, c) => c.table?.kind === "view" && (d.block === "Insert" || d.block === "Update")
    },
    {
        id: "key-type-known",
        reason: "A link whose target key the collection generator could not read (a `reference`, a relation into a target it " +
            "could not resolve) was typed `string | number`. The descriptor's column states its type.",
        explains: d => {
            if (d.kind !== "changed") return false;
            const golden = strip(d.golden);
            const generated = strip(d.generated);
            if (!golden.includes("string | number")) return false;
            return ["string", "number"].some(type => golden.split("string | number").join(type) === generated);
        }
    },
    {
        id: "native-array-element",
        reason: "An array declared by its column type alone (`columnType: \"text[]\"`, no `of`) was `Array<unknown>`. The column is " +
            "a native Postgres array, and its element type is stated.",
        explains: (d, c) => d.kind === "changed" && c.column?.type.kind === "array"
            && /Array<unknown>/.test(d.golden ?? "") && strip(d.golden).replace(/Array<unknown>/, "") !== strip(d.generated).replace(/Array<[^>]+>/, "X")
            && strip(d.golden).replace(/Array<unknown>/, "Array<X>") === strip(d.generated).replace(/Array<[^>]+>/, "Array<X>")
    },
    {
        id: "reference-in-array",
        reason: "A JSON array of `reference` items was typed `Array<string | number>`. Inside a JSON document a pointer is a " +
            "document value the server does not read (the table model's `json.unknown()`), so the item is `unknown`.",
        explains: (d, c) => d.kind === "changed" && c.column?.json?.kind === "array" && c.column.json.of.kind === "unknown"
            && strip(d.golden).replace("Array<string | number>", "Array<unknown>") === strip(d.generated)
    },
    {
        id: "link-follows-column",
        reason: "A `belongsTo` was required only when its relation property said `required`. The table model has one answer, " +
            "the foreign-key column's: a link over a NOT NULL column (here a key column) is required, written by either name.",
        explains: (d, c) => {
            const link = c.table?.relations.find(relation => relation.kind === "belongsTo" && relation.name === d.key);
            if (!link || link.kind !== "belongsTo") return false;
            const column = c.table?.columns.find(candidate => candidate.key === link.localField);
            return column !== undefined && !column.nullable && d.kind === "changed" && sameButNullability(d.golden, d.generated);
        }
    },
    {
        id: "undeclared-key",
        reason: "A property named `id` with no `isId` is the table's key to the planner (`id` is the key when nothing else is " +
            "marked), but the collection generator typed it as an ordinary nullable, updatable column.",
        explains: (d, c) => d.key === "id" && c.column?.primaryKey === true && c.column.default === undefined
            && (d.kind === "removed" ? d.block === "Update" : d.kind === "changed" && sameButNullability(d.golden, d.generated))
    }
];

/**
 * The differences no rule explains, and the rules that explained at least one.
 *
 * `tables` maps an accessor to its descriptor.
 */
export function unexplainedDifferences(
    differences: readonly SdkDifference[],
    tables: ReadonlyMap<string, TableDescriptor>,
    rules: readonly AllowedDifference[] = SDK_ALLOWED_DIFFERENCES
): { unexplained: SdkDifference[]; used: Set<string> } {
    const used = new Set<string>();
    const unexplained: SdkDifference[] = [];
    for (const difference of differences) {
        const table = tables.get(difference.table);
        const column = difference.key === undefined ? undefined : table?.columns.find(candidate => candidate.key === difference.key);
        const rule = rules.find(candidate => candidate.explains(difference, { table, column }));
        if (rule) used.add(rule.id);
        else unexplained.push(difference);
    }
    return { unexplained, used };
}
