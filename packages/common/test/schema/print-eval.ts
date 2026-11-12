/**
 * Evaluating printed schema source without touching the filesystem.
 *
 * A printed module is `import` lines plus `export const x = defineTable(…);`.
 * The imports are dropped, `export const` becomes `const`, a thunk's
 * `(): RelationTarget` annotation is erased, and the statements
 * of every module are run in one function body with the real builders passed
 * in — so relation thunks between modules resolve to each other, exactly as
 * they would across files.
 */
import { col, defineAuthTable, defineTable, defineView, isColumnBuilder, isRelationDef, json, rel } from "@rebasepro/types";
import type { ColumnDef } from "@rebasepro/types";

import { deriveColumnName } from "../../src/schema/derive-names";

const BUILDER_NAMES = ["col", "rel", "json", "defineTable", "defineAuthTable", "defineView"];
const BUILDERS: unknown[] = [col, rel, json, defineTable, defineAuthTable, defineView];

function run(body: string): unknown {
    const fn = new Function(...BUILDER_NAMES, body);
    const result: unknown = Reflect.apply(fn, undefined, BUILDERS);
    return result;
}

/** Evaluate printed modules together; returns their exports by identifier. */
export function evaluateModules(modules: readonly string[]): Record<string, unknown> {
    const identifiers: string[] = [];
    const bodies = modules.map(code => code
        .split("\n")
        .filter(line => !line.startsWith("import "))
        .join("\n")
        // The one piece of TypeScript a printed table holds: an annotated thunk.
        .replace(/\(\): RelationTarget =>/g, "() =>")
        .replace(/^export const ([A-Za-z_$][\w$]*) = /gm, (_match, identifier: string) => {
            identifiers.push(identifier);
            return `const ${identifier} = `;
        }));
    const result = run(`${bodies.join("\n")}\nreturn { ${identifiers.join(", ")} };`);
    if (typeof result !== "object" || result === null) throw new Error("printed modules evaluated to nothing");
    return Object.fromEntries(Object.entries(result));
}

/** Evaluate one printed column chain (`col.text().notNull()`) to its definition. */
export function evaluateColumn(source: string): ColumnDef {
    const result = run(`return ${source};`);
    if (!isColumnBuilder(result)) throw new Error(`not a column builder: ${source}`);
    return result.def;
}

/**
 * A definition in the form two equal definitions share: functions reduced to
 * their presence, relation targets to their name, and each column's SQL name
 * resolved (the printer leaves out a `.column()` that repeats the default).
 */
export function comparable(value: unknown, key?: string, parentKey?: string): unknown {
    if (typeof value === "function") return "[function]";
    if (typeof value !== "object" || value === null) return value;
    if (Array.isArray(value)) return value.map(item => comparable(item));
    if (isColumnBuilder(value)) return comparableColumn(value.def, key);
    if (isRelationDef(value)) {
        const target: unknown = value.target();
        const name = typeof target === "object" && target !== null && "name" in target ? target.name : undefined;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = k === "target" ? name : comparable(v, undefined, k);
        return out;
    }
    const mapOfColumns = parentKey === "columns" || parentKey === "pivot";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        out[k] = comparable(v, mapOfColumns ? k : undefined, k);
    }
    return out;
}

/** A column definition in comparable form; `key` resolves its SQL name. */
export function comparableColumn(def: ColumnDef, key: string | undefined): unknown {
    const out = comparable({ ...def }, undefined, "def");
    if (key !== undefined && typeof out === "object" && out !== null) Reflect.set(out, "column", deriveColumnName(key, def));
    return out;
}
