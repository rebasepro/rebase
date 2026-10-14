/**
 * The constraints a collection cannot declare, and how `db push` keeps Atlas
 * from dropping them.
 *
 * `db push` is declarative: Atlas makes each managed table match `schema.sql`,
 * and anything on the table that `schema.sql` does not mention is planned as a
 * drop. The collection model declares a table's primary key, its columns'
 * `NOT NULL`, `UNIQUE` and foreign keys, and nothing else. So a hand-written
 * `CHECK (total >= 0)` — or one an adopted database arrived with, which
 * `schema introspect` reads as `validation.min: 0` — was dropped by the first
 * push, in the same `ALTER TABLE` as whatever else the push changed, with no
 * prompt. From then on the database accepted every row the constraint used to
 * refuse, while the form still enforced the rule and so hid that it had gone.
 *
 * EXCLUDE constraints are the same case: Atlas inspects them and plans their
 * drop the same way. Triggers and functions are not: Atlas's free tier does
 * not inspect either, so it never plans a drop for one. Measured on the pinned
 * atlas 1.2.3 against PG 18; `introspect-check-constraints-e2e` pins all four.
 *
 * Ownership, as with indexes (`getForeignIndexExcludes` in `cli-helpers.ts`)
 * and policies: a constraint the desired state declares is
 * Atlas's to manage, and every other CHECK or EXCLUDE is somebody else's and is
 * kept out of the plan with `--exclude`. Today the desired state declares
 * neither kind, so every one is kept. A rule nobody wants any more is dropped
 * by hand (`ALTER TABLE … DROP CONSTRAINT …`), which is the only statement that
 * can say so.
 *
 * Side-effect free, so it is unit-tested without Atlas or a database.
 */

import { atlasExcludePattern } from "./atlas-exclude";

/** A constraint kind the collection model has no way to declare. */
export type UndeclarableConstraintKind = "check" | "exclude";

/** A CHECK or EXCLUDE constraint, as the database holds it now. */
export interface ExistingConstraint {
    schema: string;
    table: string;
    name: string;
    kind: UndeclarableConstraintKind;
}

/**
 * Every CHECK and EXCLUDE constraint on an ordinary or partitioned table
 * outside the system schemas.
 *
 * `contype` `c` and `x` only. A primary key (`p`), `UNIQUE` (`u`), foreign key
 * (`f`) and, from PG 18, a catalogued `NOT NULL` (`n`) are what a collection
 * declares, so Atlas keeps managing them.
 */
export const UNDECLARABLE_CONSTRAINTS_SQL = `
    SELECT n.nspname AS "schema",
           c.relname AS "table",
           con.conname AS "name",
           CASE con.contype WHEN 'c' THEN 'check' ELSE 'exclude' END AS "kind"
    FROM pg_constraint con
    JOIN pg_class c     ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype IN ('c', 'x')
      AND c.relkind IN ('r', 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'
`;

const DECLARED_CONSTRAINT_RE = /\bCONSTRAINT\s+"((?:[^"]|"")+)"\s+(?:CHECK|EXCLUDE)\b/gi;

/**
 * The CHECK and EXCLUDE constraint names a desired state (`schema.sql`)
 * declares — Atlas's to manage, and so never excluded.
 */
export function declaredConstraintNames(desiredSql: string): Set<string> {
    const names = new Set<string>();
    for (const match of desiredSql.matchAll(DECLARED_CONSTRAINT_RE)) {
        names.add(match[1].replace(/""/g, "\""));
    }
    return names;
}

/**
 * The `--exclude` patterns that keep Atlas from dropping the CHECK and EXCLUDE
 * constraints the desired state does not declare. Three-part
 * `schema.table.constraint`, which is what Atlas matches a constraint by: a
 * two-part pattern reads as a table, matches nothing, and reports no error.
 */
export function undeclaredConstraintExcludes(
    existing: readonly ExistingConstraint[],
    desiredSql: string
): string[] {
    const declared = declaredConstraintNames(desiredSql);
    return existing
        .filter(constraint => !declared.has(constraint.name))
        .map(constraint => atlasExcludePattern(constraint.schema, constraint.table, constraint.name));
}
