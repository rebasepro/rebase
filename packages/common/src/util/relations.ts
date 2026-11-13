/**
 * The names the schema generator gives a table's Drizzle variable and its enum
 * types. (The panel's relation helpers live in `@rebasepro/cms-types`.)
 *
 * @module
 */
import { toSnakeCase } from "@rebasepro/utils";

/**
 * A JavaScript identifier: what a generated `export const <name> =` needs.
 *
 * Deliberately the same shape the two schema generators already define
 * privately — this is the third place that needed it, and the first two guard
 * property keys and member accesses while nothing guarded the variable name
 * itself.
 */
const JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * The variable name a generated table is bound to.
 *
 * Camel-cases underscores, and then guarantees the result is a legal
 * identifier. It did only the first, so a table name that is legal in Postgres
 * and not in JavaScript produced a `schema.generated.ts` that does not parse:
 *
 *   `2024_archive`       → `export const 2024Archive = pgTable(…)`
 *                          "An identifier or keyword cannot immediately follow
 *                           a numeric literal"
 *   `reporting.events`   → `export const reporting.events = pgTable(…)`
 *                          "',' expected"
 *
 * That file is imported by the server, so the failure is not one broken
 * collection — `rebase build` and `db push` fail at tsc for the whole
 * directory. And it is reachable from a documented flow: `rebase init` against
 * a database holding a table called `2024_archive` writes a collection file
 * that parses and a schema file that does not.
 *
 * **A no-op for every name that already worked**, which is what makes changing
 * a derived name safe here: the only inputs whose output changes are the ones
 * that produced a syntax error, and nothing can be running against those.
 * Separators become camel case rather than disappearing, so `reporting.events`
 * and `reporting_events` do not collide into one variable.
 */
export function getTableVarName(tableName: string): string {
    const camel = tableName.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
    if (JS_IDENTIFIER.test(camel)) return camel;

    const sanitised = camel
        // Any other separator gets the same treatment `_` did, so two tables
        // differing only by separator keep differing.
        .replace(/[^A-Za-z0-9_$]+([A-Za-z0-9])?/g, (_, char?: string) =>
            (char ? char.toUpperCase() : ""))
        // A leading digit is legal in Postgres and not in JavaScript. Prefixed
        // rather than stripped, so `2024_archive` and `archive` stay distinct.
        .replace(/^([0-9])/, "t$1");

    return JS_IDENTIFIER.test(sanitised) ? sanitised : `t${sanitised}`;
}

export function getEnumVarName(tableName: string, propName: string): string {
    const tableVar = getTableVarName(tableName);
    const propVar = propName.charAt(0).toUpperCase() + propName.slice(1);
    return `${tableVar}${propVar}`;
}
