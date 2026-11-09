/**
 * Adopting an index the database already has, instead of building a twin.
 *
 * A declared index is found by its derived name (`collection-index.ts`), so an
 * index someone made by hand — or one an introspected database arrived with —
 * is invisible to it however exactly it matches the declaration: boot and
 * `db push` built the same index again under the derived name, and every write
 * to the table then maintained two. Declaring the indexes an application
 * already has is the first thing anyone does when they bring a database to
 * Rebase, so that was the common case, not an edge.
 *
 * So before an index is built, an existing one with the same definition on the
 * same table takes the derived name (`ALTER INDEX … RENAME TO …`: a catalogue
 * update, no rebuild, a brief lock). From then on it is the declared index:
 * found by name, kept by push, dropped when the declaration is removed.
 *
 * "The same definition" is read from the catalogue part by part, not by
 * comparing SQL text: the access method, uniqueness, the key columns in order
 * with their direction and NULLS placement, the INCLUDE columns, the predicate,
 * and — because two indexes over the same columns can still answer different
 * queries — that every key uses its type's default operator class and the
 * column's own collation. An index that differs in any of those, is over an
 * expression, backs a constraint, is INVALID, or already carries a Rebase name
 * is left alone, and the declared one is built beside it as before.
 *
 * A partial index is adopted only when the two predicates read the same once
 * Postgres's own spelling is normalised away (identifier quotes, casts on
 * literals, parentheses, case). A wrong adoption would leave a declared index
 * answering a narrower question than the one declared, so a predicate this
 * cannot read as the same is not adopted.
 */
import { isRebaseIndexName, renderPredicate, type CollectionIndexSpec } from "./collection-index";

/** What the catalogue says about one existing index. */
export interface ExistingIndexShape {
    schema: string;
    table: string;
    index: string;
    method: string;
    unique: boolean;
    /** Key columns in order; `null` where a key is an expression. */
    keys: (string | null)[];
    /** `pg_index.indoption` per key: bit 1 is DESC, bit 2 is NULLS FIRST. */
    options: number[];
    include: string[];
    /** `pg_get_expr` of the predicate, or `null` for a whole-table index. */
    predicate: string | null;
    /** Every key uses its type's default operator class and the column's collation. */
    defaultOpclassAndCollation: boolean;
    /** Backs a primary key, unique or exclusion constraint. */
    constraint: boolean;
    /** False when a cancelled concurrent build left it unusable. */
    valid: boolean;
}

/** An existing index taking a declared index's name. */
export interface IndexAdoption {
    schema: string;
    table: string;
    /** Its name now. */
    from: string;
    /** The declared index's derived name. */
    to: string;
}

/**
 * Every index on an ordinary or partitioned table in `schemas`, as
 * {@link ExistingIndexShape} rows. The schema names are written in as quoted
 * literals: the boot's catalogue reader runs its queries without parameters.
 */
export const indexShapesSql = (schemas: readonly string[]): string => `
SELECT n.nspname AS "schema",
       t.relname AS "table",
       i.relname AS "index",
       am.amname AS "method",
       x.indisunique AS "unique",
       ARRAY(
           SELECT a.attname::text
           FROM unnest((x.indkey::int2[])[0:x.indnkeyatts - 1]) WITH ORDINALITY AS k(attnum, ord)
           LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND k.attnum > 0
           ORDER BY k.ord
       ) AS "keys",
       ARRAY(SELECT o::int FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS u(o, ord) ORDER BY u.ord) AS "options",
       ARRAY(
           SELECT a.attname::text
           FROM unnest((x.indkey::int2[])[x.indnkeyatts:]) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           ORDER BY k.ord
       ) AS "include",
       pg_get_expr(x.indpred, x.indrelid) AS "predicate",
       NOT EXISTS (
           SELECT 1
           FROM unnest((x.indclass::oid[])[0:x.indnkeyatts - 1], (x.indcollation::oid[])[0:x.indnkeyatts - 1],
                       (x.indkey::int2[])[0:x.indnkeyatts - 1]) AS k(opclass, coll, attnum)
           JOIN pg_opclass oc ON oc.oid = k.opclass
           LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           WHERE NOT oc.opcdefault OR NULLIF(k.coll, 0) IS DISTINCT FROM NULLIF(a.attcollation, 0)
       ) AS "defaultOpclassAndCollation",
       EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid) AS "constraint",
       x.indisvalid AS "valid"
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am am ON am.oid = i.relam
WHERE n.nspname IN (${[...new Set(schemas)].map(schema => `'${schema.replace(/'/g, "''")}'`).join(", ")})
  AND t.relkind IN ('r', 'p')
ORDER BY n.nspname, t.relname, i.relname`;

/** Something that runs a query: a pg client or pool, the boot's catalogue reader, a test double. */
export interface ShapeQueryable {
    query<R>(text: string): Promise<{ rows: R[] }>;
}

/** Read the {@link ExistingIndexShape}s of the given schemas. */
export async function readIndexShapes(client: ShapeQueryable, schemas: readonly string[]): Promise<ExistingIndexShape[]> {
    if (schemas.length === 0) return [];
    const { rows } = await client.query<ExistingIndexShape>(indexShapesSql(schemas));
    return rows;
}

/**
 * A predicate with Postgres's own spelling taken out: identifier quotes, the
 * casts it puts on literals (`'live'::text`), parentheses, case, whitespace.
 */
function normalizePredicate(text: string): string {
    return text
        .replace(/::(?:character varying|double precision|time(?:stamp)?(?: with(?:out)? time zone)?|[a-z_][a-z0-9_]*)(?:\[\])?/gi, "")
        .replace(/"/g, "")
        .replace(/[()]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/** Whether `shape` is `spec` under another name. */
export function indexMatchesSpec(spec: CollectionIndexSpec, shape: ExistingIndexShape): boolean {
    if (shape.schema !== spec.schema || shape.table !== spec.table) return false;
    if (shape.constraint || !shape.valid || !shape.defaultOpclassAndCollation) return false;
    if (shape.method !== spec.method || shape.unique !== spec.unique) return false;
    if (shape.keys.length !== spec.keys.length) return false;
    // Only btree orders its keys; every other method reports `asc`.
    const ordered = spec.method === "btree";
    for (let i = 0; i < spec.keys.length; i++) {
        const key = spec.keys[i];
        if (shape.keys[i] === null || shape.keys[i] !== key.column) return false;
        if (!ordered) continue;
        const desc = (shape.options[i] & 1) === 1;
        const nullsFirst = (shape.options[i] & 2) === 2;
        if (desc !== (key.direction === "desc") || nullsFirst !== (key.nulls === "first")) return false;
    }
    if (shape.include.length !== spec.include.length || shape.include.some((column, i) => column !== spec.include[i])) return false;
    if ((shape.predicate === null) !== (spec.predicate === null)) return false;
    if (shape.predicate !== null && spec.predicate !== null
        && normalizePredicate(shape.predicate) !== normalizePredicate(renderPredicate(spec.predicate))) return false;
    return true;
}

/**
 * The renames that make existing indexes the declared ones: for each spec
 * whose derived name the catalogue does not hold, the first existing index on
 * its table with the same definition — never one carrying a Rebase name (it is
 * some declaration's, or one a removed declaration left for push to drop), and
 * never the same one twice.
 */
export function planIndexAdoptions(
    specs: readonly CollectionIndexSpec[],
    shapes: readonly ExistingIndexShape[]
): IndexAdoption[] {
    const held = new Set(shapes.map(shape => `${shape.schema}.${shape.index}`));
    const taken = new Set<string>();
    const adoptions: IndexAdoption[] = [];
    for (const spec of specs) {
        if (held.has(`${spec.schema}.${spec.indexName}`)) continue;
        const match = shapes.find(shape =>
            !taken.has(`${shape.schema}.${shape.index}`) && !isRebaseIndexName(shape.index) && indexMatchesSpec(spec, shape));
        if (!match) continue;
        taken.add(`${match.schema}.${match.index}`);
        held.add(`${spec.schema}.${spec.indexName}`);
        adoptions.push({ schema: spec.schema, table: spec.table, from: match.index, to: spec.indexName });
    }
    return adoptions;
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

/** The `ALTER INDEX … RENAME TO …` for one adoption. */
export function indexAdoptionStatement(adoption: IndexAdoption): string {
    return `ALTER INDEX ${quoteIdent(adoption.schema)}.${quoteIdent(adoption.from)} RENAME TO ${quoteIdent(adoption.to)};`;
}

/**
 * A migration's `CREATE INDEX` of a declared (Rebase-named) index, written
 * `CREATE INDEX IF NOT EXISTS`. `rebase db migrate` adopts an identical
 * existing index before it applies — renaming it to the declared name — and
 * the migration's own statement then finds it there instead of failing on the
 * name. An index named any other way is left as Atlas wrote it.
 */
export function declaredIndexesIfNotExists(migrationSql: string): { sql: string; rewritten: number } {
    let rewritten = 0;
    const sql = migrationSql.replace(
        /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b|CONCURRENTLY\b)"([^"]+)"/gi,
        (statement, unique: string | undefined, name: string) => {
            if (!isRebaseIndexName(name)) return statement;
            rewritten++;
            return `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS "${name}"`;
        }
    );
    return { sql, rewritten };
}
