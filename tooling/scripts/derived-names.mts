/**
 * Render every database identifier this framework *derives* rather than is told.
 *
 * ## What this is for
 *
 * A column name is an API. Not the authored TypeScript kind — that one costs a
 * compile error and five minutes — but the kind that is written into a customer's
 * database on the day they deploy and is still there two years later. Once a
 * release has emitted an identifier, every database provisioned by that release
 * carries it, and nothing this repo does afterwards can reach in and change it.
 *
 * 0.13 is what taught us to write this down. `generateForeignKeyName` learned to
 * singularize properly, which is a genuine improvement — `categorie_id` became
 * `category_id`, `addres_id` became `address_id` — and every aged database in the
 * world disagreed with the code the moment it upgraded. Boot-ensure migrated the
 * column, so the data survived; the project's checked-in generated schema did
 * not, and the boot died on a column that existed. The fix took three commits and
 * a new seam test. The change bought nobody anything they had asked for.
 *
 * So the rule, and this file is the thing that enforces it:
 *
 * > **A derived identifier is frozen the moment a release emits it.** A better
 * > derivation applies to collections created afterwards, behind a naming
 * > strategy stamped into the project — never retroactively.
 *
 * ## What it renders
 *
 * The fixture below is a collection set chosen to make every naming rule fire at
 * once: irregular plurals, a junction whose column name comes from a plural slug,
 * an `ss` ending, an acronym, explicit overrides that must be inert to all of it,
 * and a slug long enough to hit Postgres's 63-byte identifier limit. It is run
 * through both producers of schema DDL —
 *
 *   * `push` — `generatePostgresDdl` plus the two files Atlas is not shown,
 *     `generatePostgresSearchDdl` and `generatePostgresVectorDdl`; together,
 *     what `rebase db push` writes — and
 *   * `boot` — `planCollectionSchemaEnsure` / `planCollectionPolicies`, what the
 *     managed runtime applies at boot against an empty database
 *
 * — and every identifier either one names is listed with the producers that name
 * it. That second column is load-bearing: boot and push compile the same
 * collections and must agree, and a name that appears under only one of them is a
 * project whose schema depends on which command touched it first.
 *
 * A statement shape this file cannot parse is emitted as `unhandled`, so a new
 * kind of named object cannot enter the schema without showing up in the diff.
 * Silence is the one thing a frozen-contract gate must never produce.
 *
 *     node --import tsx tooling/scripts/derived-names.mts            # print
 *     pnpm write:derived-names                               # update the baseline
 *     pnpm check:derived-names                               # the gate
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const BASELINE = path.join(ROOT, "contracts/derived-names.txt");

// ── The fixture ──────────────────────────────────────────────────────────────
//
// Append-only, in the same sense the baseline is: removing a collection from
// here removes whatever it was the only thing exercising, and the baseline
// shrinks by exactly as much without anything failing. Add cases; do not prune.

/** Loose on purpose — this is a fixture, not a consumer of the config types. */
type Fixture = Record<string, unknown>;

/**
 * What the fixture project's database gives Rebase leave to install.
 *
 * `vector` is here so the extension stays *rendered*. It is opt-in
 * (`DatabaseOptions.extensions`), and a fixture that declined it would emit no
 * `CREATE EXTENSION` from either producer — quietly dropping a frozen
 * identifier from the baseline, which is the one thing this file exists to
 * prevent. The fixture opts into everything, for the same reason it declares
 * every naming rule at once.
 */
const FIXTURE_DATABASE_EXTENSIONS = ["vector"] as const;

const uuidId = { id: { name: "ID", type: "string", isId: "uuid" } };
const serialId = { id: { name: "ID", type: "number", isId: "increment" } };

/** Every operation, so the hashed policy name of each is pinned. */
const allOperations = [
    { operation: "select", access: "public" },
    { operation: "insert", access: "authenticated" },
    { operation: "update", access: "authenticated" },
    { operation: "delete", access: "authenticated" }
];

/** Irregular plural: `categories` → `category_id`, and `categorie_id` before 0.13. */
const categories: Fixture = {
    slug: "categories",
    table: "categories",
    name: "Categories",
    securityRules: allOperations,
    properties: { ...uuidId, name: { type: "string" } }
};

/** The `ss` guard: a trailing double-s is never a plural marker. */
const addresses: Fixture = {
    slug: "addresses",
    table: "addresses",
    name: "Addresses",
    properties: { ...uuidId, street: { type: "string" } }
};

/** An irregular that `singular()` handles and a trailing-s chop never could. */
const children: Fixture = {
    slug: "children",
    table: "children",
    name: "Children",
    properties: { ...uuidId, nickname: { type: "string" } }
};

/** The acronym case: snake-casing before singularizing produced `ur_l_id`. */
const urls: Fixture = {
    slug: "URLs",
    table: "urls",
    name: "URLs",
    properties: { ...uuidId, href: { type: "string" } }
};

/** `-es` plural, and a numeric key, so junction column types are pinned too. */
const statuses: Fixture = {
    slug: "statuses",
    table: "statuses",
    name: "Statuses",
    properties: { ...serialId, label: { type: "string" } }
};

/** A regular plural — the common case, and the one that must never move. */
const tags: Fixture = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: { ...serialId, label: { type: "string" } }
};

/**
 * The centre of the fixture: one collection carrying every relation kind, an
 * enum, a camelCase property, and a name long enough to truncate.
 */
const products: Fixture = {
    slug: "products",
    table: "products",
    name: "Products",
    securityRules: allOperations,
    properties: {
        ...uuidId,
        title: { type: "string" },
        // camelCase → snake_case is a derivation like any other.
        createdBy: { type: "string" },
        // Enum type names are derived from table + column.
        status: { type: "string", enum: ["draft", "published", "archived"] },
        // belongsTo derives from the RELATION name (usually singular already).
        primaryCategory: {
            type: "relation",
            relation: { kind: "belongsTo", target: () => categories, relationName: "primaryCategory" }
        },
        // manyToMany derives from the endpoint SLUG, which is plural — this is
        // the shape the 0.13 singularization actually moved.
        categories: {
            type: "relation",
            relation: { kind: "manyToMany", target: () => categories, relationName: "categories" }
        },
        tags: {
            type: "relation",
            relation: { kind: "manyToMany", target: () => tags, relationName: "tags" }
        },
        // A numeric-keyed endpoint, so the junction column's TYPE is pinned as
        // well as its name.
        statuses: {
            type: "relation",
            relation: { kind: "manyToMany", target: () => statuses, relationName: "statuses" }
        },
        // A plain reference, which names a column the same way and is a
        // different code path to get there.
        supplier: { type: "reference", path: "suppliers" },
        // A vector column, so the ANN index name is frozen like any other
        // derived identifier. 1536 is within what pgvector can index; a wider
        // one creates no index and would therefore name nothing to freeze.
        embedding: { type: "vector", dimensions: 1536 },
        // A date and an array, carried so the `indexes` block below can fire a
        // DESC key, a BRIN and a GIN. Neither derives a name on its own.
        createdAt: { type: "date" },
        keywords: { type: "array", columnType: "text[]" }
    },
    /**
     * Declared indexes, chosen so every part of the fingerprint moves at least
     * one name.
     *
     * The two `created_at` entries are the point of the exercise: same table,
     * same column, same readable head, two different indexes — one partial,
     * one BRIN. Under a readable naming scheme they would collide, and because
     * `CREATE INDEX IF NOT EXISTS` matches on the name, the second would
     * silently never be created. Here they differ in the hash alone.
     */
    indexes: [
        { on: ["status"], reason: "admin list filters by status" },
        { on: ["status", { prop: "createdAt", direction: "desc" }], reason: "status feed, newest first" },
        { on: ["createdAt"], where: { prop: "status", op: "=", value: "published" }, reason: "public feed is published-only" },
        { on: ["createdAt"], using: "brin", reason: "append-only scan over the whole table" },
        { on: ["title"], include: ["status"], reason: "index-only scan for the status column" },
        { on: ["keywords"], using: "gin", reason: "keyword containment search" },
        // A belongsTo resolves to its foreign key column, so this freezes
        // `primary_category_id` — not `primary_category`.
        { on: ["primaryCategory", "status"], unique: true, reason: "one product per category and status" }
    ]
};

/**
 * Overrides. Nothing in this collection may EVER move: every name here was
 * written by the author, and a naming change that reaches these is a bug in the
 * override plumbing, not a derivation change.
 */
const pinned: Fixture = {
    slug: "pinned_names",
    table: "pinned_names",
    name: "Pinned",
    properties: {
        ...uuidId,
        renamedColumn: { type: "string", columnName: "explicit_column_name" },
        category: {
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => categories,
                relationName: "category",
                localKey: "explicit_category_key"
            }
        }
    }
};

/** A non-public schema, because the schema qualifies every name downstream. */
const inventory: Fixture = {
    slug: "inventory_items",
    table: "inventory_items",
    name: "Inventory",
    schema: "shop",
    securityRules: allOperations,
    properties: { ...uuidId, sku: { type: "string" } },
    // The schema is in the fingerprint, so the identical declaration on a
    // `public` table hashes differently. Nothing else in the fixture proves it.
    indexes: [{ on: ["sku"], reason: "warehouse lookup by SKU" }]
};

/**
 * 63 bytes is where Postgres truncates an identifier, silently. A constraint
 * name is `<table>_<column>_fkey`, so a long table plus a long column is how you
 * reach it — and two names that truncate to the same string collide in the
 * catalogue while looking distinct in the code.
 */
const longName: Fixture = {
    slug: "extremely_long_collection_slug_for_identifier_truncation",
    table: "extremely_long_collection_slug_for_identifier_truncation",
    name: "Long",
    properties: {
        ...uuidId,
        correspondingOrganizationalUnit: {
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => categories,
                relationName: "correspondingOrganizationalUnit"
            }
        }
    },
    /**
     * The truncation case. A 56-byte table plus a 36-byte column is far over
     * 63, so the readable head is cut — and the `_ix_` tag and the hash, which
     * are what make the name recognisable and unique, must both survive.
     *
     * The baseline records the answer. Compare it against the `_fkey` line for
     * this same collection, which is frozen with its suffix truncated away.
     */
    indexes: [{ on: ["correspondingOrganizationalUnit"], reason: "join back to the owning unit" }]
};

const suppliers: Fixture = {
    slug: "suppliers",
    table: "suppliers",
    name: "Suppliers",
    properties: { ...uuidId, name: { type: "string" } }
};

/**
 * The reference project.
 *
 * Exported because `tooling/scripts/record-project-snapshot.mts` provisions a database
 * from it, once per release, to build the aged-project corpus. One fixture drives
 * both gates on purpose: the names this one freezes are the names that corpus
 * then has to still be able to migrate, and a case that is worth stressing in one
 * is worth stressing in the other.
 */
export const FIXTURE: Fixture[] = [
    products, categories, addresses, children, urls, statuses, tags,
    pinned, inventory, longName, suppliers
];

// ── Parsing ──────────────────────────────────────────────────────────────────

type Producer = "push" | "boot";

/** kind + identifier → the producers that emitted it. */
type Surface = Map<string, Set<Producer>>;

const record = (surface: Surface, producer: Producer, kind: string, id: string): void => {
    const key = `${kind} ${id}`;
    const producers = surface.get(key) ?? new Set<Producer>();
    producers.add(producer);
    surface.set(key, producers);
};

/**
 * Split a `CREATE TABLE` body on top-level commas.
 *
 * Depth-aware because a type modifier carries its own comma — `NUMERIC(10,2)`
 * splits into two garbage fragments under a naive `split(",")`, and the second
 * one would be recorded as a column called `2`.
 */
function splitTopLevel(body: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of body) {
        if (char === "(") depth++;
        if (char === ")") depth--;
        if (char === "," && depth === 0) {
            parts.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    if (current.trim()) parts.push(current);
    return parts.map(p => p.trim()).filter(Boolean);
}

/**
 * Pull every named object out of one statement.
 *
 * Anything unrecognised is recorded as `unhandled` rather than dropped: a new
 * statement shape means a new kind of derived name, and the whole point of the
 * baseline is that such a thing cannot arrive quietly.
 */
function readStatement(surface: Surface, producer: Producer, statement: string): void {
    // The trailing semicolon is present on a planned action's `sql` and absent
    // on a statement split out of a DDL blob. Normalising it here is what lets
    // the two producers be compared at all.
    const sql = statement.trim().replace(/\s+/g, " ").replace(/;$/, "").trim();
    if (!sql) return;

    // Noise: neither names anything the database keeps under a derived name.
    if (/^DROP POLICY IF EXISTS/i.test(sql)) return;                 // paired with CREATE POLICY
    if (/^ALTER TABLE .* ENABLE ROW LEVEL SECURITY/i.test(sql)) return;
    if (/^(SET|COMMENT|GRANT|REVOKE|BEGIN|COMMIT)\b/i.test(sql)) return;
    // The drift guards `search.sql` and `vector.sql` open with. They create
    // nothing — they read a column that the `ADD COLUMN` beside them has
    // already recorded, and raise. Their bodies are prose, so freezing them
    // would make this contract fire on a reworded error message.
    if (/^DO \$rebase_[a-z_]+\$/i.test(sql)) return;

    let m: RegExpMatchArray | null;

    if ((m = sql.match(/^CREATE EXTENSION(?: IF NOT EXISTS)? "?([A-Za-z0-9_]+)"?/i))) {
        record(surface, producer, "extension", m[1]);
        return;
    }

    if ((m = sql.match(/^CREATE SCHEMA(?: IF NOT EXISTS)? "([^"]+)"/i))) {
        record(surface, producer, "schema", m[1]);
        return;
    }

    if ((m = sql.match(/^CREATE TYPE "([^"]+)"\."([^"]+)" AS ENUM/i))) {
        record(surface, producer, "enum", `${m[1]}.${m[2]}`);
        return;
    }

    if ((m = sql.match(/^CREATE TABLE(?: IF NOT EXISTS)? "([^"]+)"\."([^"]+)" \((.*)\)$/i))) {
        const [, schema, table, body] = m;
        const qualified = `${schema}.${table}`;
        record(surface, producer, "table", qualified);
        for (const part of splitTopLevel(body)) {
            const column = part.match(/^"([^"]+)"/);
            if (column) {
                record(surface, producer, "column", `${qualified}.${column[1]}`);
                continue;
            }
            const named = part.match(/^CONSTRAINT "([^"]+)"/i);
            if (named) {
                record(surface, producer, "constraint", `${qualified}.${named[1]}`);
                continue;
            }
            // An unnamed table constraint — Postgres derives the catalogue name
            // itself, so what is frozen is the column list it derives it from.
            const inline = part.match(/^(PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)\s*(.*)$/i);
            if (inline) {
                record(surface, producer, "table-constraint", `${qualified} ${inline[1].toUpperCase()} ${inline[2]}`);
                continue;
            }
            record(surface, producer, "unhandled", `table-body ${qualified}: ${part.slice(0, 60)}`);
        }
        return;
    }

    if ((m = sql.match(/^ALTER TABLE(?: IF EXISTS)? "([^"]+)"\."([^"]+)" ADD CONSTRAINT "([^"]+)"/i))) {
        record(surface, producer, "constraint", `${m[1]}.${m[2]}.${m[3]}`);
        return;
    }

    if ((m = sql.match(/^ALTER TABLE(?: IF EXISTS)? "([^"]+)"\."([^"]+)" ADD COLUMN(?: IF NOT EXISTS)? "([^"]+)"/i))) {
        record(surface, producer, "column", `${m[1]}.${m[2]}.${m[3]}`);
        return;
    }

    if ((m = sql.match(/^ALTER TABLE(?: IF EXISTS)? "([^"]+)"\."([^"]+)" RENAME COLUMN "([^"]+)" TO "([^"]+)"/i))) {
        record(surface, producer, "rename", `${m[1]}.${m[2]}: ${m[3]} -> ${m[4]}`);
        return;
    }

    // CONCURRENTLY is optional because the two producers differ on exactly it:
    // a migration replays as one unit and may not build concurrently, while the
    // boot-time ensure runs statement by statement against live tables and must.
    // Without this alternative the boot producer's indexes matched nothing here,
    // so every index name would have rendered push-only — which this file's own
    // header calls a defect.
    if ((m = sql.match(/^CREATE(?: UNIQUE)? INDEX(?: CONCURRENTLY)?(?: IF NOT EXISTS)? "?([^"\s]+)"? ON "([^"]+)"\."([^"]+)"/i))) {
        record(surface, producer, "index", `${m[2]}.${m[3]}.${m[1]}`);
        return;
    }

    if ((m = sql.match(/^CREATE POLICY "([^"]+)" ON "([^"]+)"\."([^"]+)" AS (\w+) FOR (\w+)/i))) {
        record(surface, producer, "policy", `${m[2]}.${m[3]}.${m[1]} (${m[4].toLowerCase()} ${m[5].toLowerCase()})`);
        return;
    }

    record(surface, producer, "unhandled", sql.slice(0, 90));
}

/** `$$` or `$tag$`, anchored — a dollar-quote delimiter and nothing else. */
const DOLLAR_QUOTE = /\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$/y;

/**
 * Statements, from a DDL blob.
 *
 * Comment lines go first: a `--` line can contain a semicolon, and the split
 * below is naive by design — a real SQL parser here would be a second
 * implementation of the thing under test.
 *
 * Naive but not *blind*: it tracks dollar quoting, because `vector.sql` and
 * `search.sql` open with `DO $rebase_…$ … $rebase_…$;` blocks whose bodies
 * contain semicolons. Splitting through one shreds it into half a dozen
 * fragments, each recorded as its own `unhandled` line carrying a slice of an
 * error message — so the baseline would churn on prose and say nothing about
 * names.
 */
const statementsOf = (ddl: string): string[] => {
    const source = ddl
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n");

    const statements: string[] = [];
    let current = "";
    let openTag: string | null = null;
    let i = 0;

    while (i < source.length) {
        if (openTag) {
            if (source.startsWith(openTag, i)) {
                current += openTag;
                i += openTag.length;
                openTag = null;
                continue;
            }
            current += source[i++];
            continue;
        }
        if (source[i] === "$") {
            DOLLAR_QUOTE.lastIndex = i;
            const tag = DOLLAR_QUOTE.exec(source);
            if (tag) {
                openTag = tag[0];
                current += tag[0];
                i += tag[0].length;
                continue;
            }
        }
        if (source[i] === ";") {
            statements.push(current.trim());
            current = "";
            i++;
            continue;
        }
        current += source[i++];
    }
    if (current.trim()) statements.push(current.trim());

    return statements.filter(Boolean);
};

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * Refuse to render against built output.
 *
 * `@rebasepro/utils` resolves to `dist/index.es.js` by default, so the naming
 * functions this gate exists to freeze arrive from the last build rather than
 * from source unless `TSX_TSCONFIG_PATH` points tsx at a config carrying the
 * workspace `paths`. That failure is silent and total: the first draft of this
 * file reported "136 identifiers unchanged" against a checkout where
 * `generateForeignKeyName` had been reverted to the pre-0.13 rule. A gate that
 * passes while the contract it guards is broken is worse than no gate.
 */
async function assertResolvesToSource(): Promise<void> {
    const howToRun =
        "Run it the way the gate does — the env var is what maps @rebasepro/* onto source:\n" +
        "  TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx tooling/scripts/derived-names.mts";

    let fromPackage: { generateForeignKeyName(name: string): string };
    try {
        fromPackage = await import("@rebasepro/utils");
    } catch {
        // Unresolvable from `tooling/scripts/`, which is not a workspace package —
        // meaning the paths mapping is not in effect at all.
        throw new Error(`\`@rebasepro/utils\` does not resolve from here.\n\n${howToRun}`);
    }
    const fromSource = await import(`${ROOT}/packages/utils/src/names.ts`);

    const probe = "categories";
    if (fromPackage.generateForeignKeyName(probe) !== fromSource.generateForeignKeyName(probe)) {
        throw new Error(
            "`@rebasepro/utils` and packages/utils/src disagree — this is rendering against a\n" +
            `stale build (dist says "${fromPackage.generateForeignKeyName(probe)}", ` +
            `source says "${fromSource.generateForeignKeyName(probe)}").\n\n${howToRun}`
        );
    }
}

export async function render(): Promise<string> {
    await assertResolvesToSource();

    const {
        generatePostgresDdl,
        generatePostgresSearchDdl,
        generatePostgresVectorDdl,
        planCollectionPolicies,
        planRelationalColumns,
        planJunctionTables
    } = await import(`${ROOT}/packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts`);
    const { planCollectionSchemaEnsure } =
        await import(`${ROOT}/packages/server-postgres/src/schema/ensure-collection-tables.ts`);

    const surface: Surface = new Map();

    // `db push`: every file it writes, not just `schema.sql`. The search and
    // vector objects are Atlas-excluded and applied from their own files, so a
    // renderer reading only the desired state would report them boot-only —
    // which this file's own header calls a defect — and would miss
    // `CREATE EXTENSION vector` entirely, since that is the one statement
    // `schema.sql` must never carry.
    const pushDdl: string = await generatePostgresDdl(FIXTURE, {
        includePolicies: true,
        includeSearch: false,
        includeVector: false
    });
    const pushFiles = [
        pushDdl,
        generatePostgresSearchDdl(FIXTURE) as string,
        generatePostgresVectorDdl(FIXTURE, { extensions: FIXTURE_DATABASE_EXTENSIONS }) as string
    ];
    for (const file of pushFiles) {
        for (const statement of statementsOf(file)) readStatement(surface, "push", statement);
    }

    // Boot, against a database with nothing in it — the managed first-deploy
    // case, and the only starting state where boot emits its full surface.
    const emptyDb = { tables: new Map(), enums: new Set(), constraints: new Set() };
    for (const action of planCollectionSchemaEnsure(FIXTURE, emptyDb, {
        databaseExtensions: FIXTURE_DATABASE_EXTENSIONS
    }).actions) {
        readStatement(surface, "boot", action.sql);
    }
    for (const plan of planCollectionPolicies(FIXTURE)) {
        for (const statement of plan.policyStatements) readStatement(surface, "boot", statement);
    }

    // The legacy names. These are not emitted — they are what boot-ensure
    // RECOGNISES in an aged database in order to rename it, so they are every
    // bit as frozen as the current ones: drop one and an aged database silently
    // gets a second, empty column beside its populated one.
    const legacy: string[] = [];
    for (const plan of planRelationalColumns(FIXTURE)) {
        if (plan.legacyColumn) {
            legacy.push(`legacy-column ${plan.schema}.${plan.table}.${plan.column} <- ${plan.legacyColumn}`);
        }
    }
    for (const plan of planJunctionTables(FIXTURE)) {
        for (const column of plan.columns) {
            if (column.legacyName) {
                legacy.push(`legacy-column ${plan.schema}.${plan.table}.${column.name} <- ${column.legacyName}`);
            }
        }
    }

    const lines = [...surface.entries()]
        .map(([key, producers]) => `${key} [${[...producers].sort().join(",")}]`)
        .concat(legacy.sort())
        .sort((a, b) => a.localeCompare(b, "en"));

    return [
        "# Derived database identifiers — FROZEN.",
        "#",
        "# Generated by tooling/scripts/derived-names.mts. Do not hand-edit.",
        "#",
        "# Every line is an identifier one of the two producers below writes into a",
        "# customer's database. A line that CHANGES or DISAPPEARS is a break:",
        "# databases in the field carry the old name, and no release can reach in and",
        "# rename them. See docs/compatibility.md, contract 6.",
        "#",
        "# Not every line is *derived*. `addresses.street` is a fixture property",
        "# someone wrote down; `categories_products.category_id` is a name this",
        "# framework invented from two slugs. Both are listed, because the filter that",
        "# would keep only the second one needs a rule for what counts as derived —",
        "# and that rule is exactly the gap a NEW derivation slips through unlisted.",
        "# So everything either producer names is rendered, and the diff decides.",
        "# On an authored line the load-bearing part is the tag, not the name.",
        "#",
        "# The [push,boot] tag is which producer emits it. Both, or it is a bug:",
        "# `rebase db push` and the managed runtime's boot compile the same",
        "# collections and must describe the same database.",
        "#",
        "# One documented exception: `schema` lines are push-only. Boot does create",
        "# its schemas, but in the applier (ensure-collection-tables.ts, the",
        "# `CREATE SCHEMA IF NOT EXISTS` before the plan runs) rather than in the",
        "# plan this renders. Any OTHER push-only or boot-only line is a defect.",
        "",
        ...lines,
        ""
    ].join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

// Run only when invoked directly. A suffix test would be wrong here:
// `check-derived-names.mts` also ends with "derived-names.mts", so importing the
// renderer from the gate would print the whole surface ahead of the verdict.
if (path.basename(process.argv[1] ?? "") === "derived-names.mts") {
    const rendered = await render();
    if (process.argv.includes("--write")) {
        fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
        fs.writeFileSync(BASELINE, rendered);
        const count = rendered.split("\n").filter(l => l && !l.startsWith("#")).length;
        console.log(`\x1b[32m✓\x1b[0m Wrote ${path.relative(ROOT, BASELINE)} — ${count} identifier(s).`);
    } else {
        process.stdout.write(rendered);
    }
}
