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
 *   * `boot` — `planTableSchemaEnsure` / `planCollectionPolicies`, what the
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

// The fixture lives in a module of its own because three consumers read it —
// this gate, `record-project-snapshot.mts` and the plan-golden corpus in
// server-postgres — and the last is a jest suite, which cannot import this
// script (it awaits at the top level).
import { FIXTURE, FIXTURE_DATABASE_EXTENSIONS } from "./derived-names-fixture.ts";
import type { CompiledTable } from "@rebasepro/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const BASELINE = path.join(ROOT, "contracts/derived-names.txt");

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
    if (/^DROP TRIGGER IF EXISTS/i.test(sql)) return;                // paired with CREATE TRIGGER
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

    // A function is named with its argument types: `rebase_search_text` is
    // overloaded, and each overload is its own catalogue object.
    if ((m = sql.match(/^CREATE(?: OR REPLACE)? FUNCTION ([^\s(]+)\(([^)]*)\)/i))) {
        record(surface, producer, "function", `${m[1].replace(/"/g, "")}(${m[2].trim()})`);
        return;
    }

    if ((m = sql.match(/^CREATE TRIGGER "([^"]+)" .*? ON "([^"]+)"\."([^"]+)"/i))) {
        record(surface, producer, "trigger", `${m[2]}.${m[3]}.${m[1]}`);
        return;
    }

    if ((m = sql.match(/^CREATE MATERIALIZED VIEW "([^"]+)"\."([^"]+)"/i))) {
        record(surface, producer, "materialized-view", `${m[1]}.${m[2]}`);
        return;
    }

    if ((m = sql.match(/^CREATE VIEW "([^"]+)"\."([^"]+)"/i))) {
        record(surface, producer, "view", `${m[1]}.${m[2]}`);
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

/**
 * The statements `views.sql` creates its views with.
 *
 * The file is one `DO $rebase_views$` block, which {@link readStatement} skips
 * as a whole: its guards are prose. What it creates is in the `EXECUTE`
 * bodies, each dollar-quoted with a tag of its own (see `dollarTag` in
 * `render-ddl.ts`), so those are what is read.
 */
const viewStatementsOf = (ddl: string): string[] =>
    [...ddl.matchAll(/EXECUTE (\$rebase_view(?:_\d+)?\$)([\s\S]*?)\1;/g)].map(match => match[2]);

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

/** What the two producers name for one fixture: the surface, and the legacy names boot recognises. */
interface Rendered {
    surface: Surface;
    legacy: string[];
}

/** The fixture as the planner reads it: compiled tables. */
type FixtureInput = CompiledTable[];

/**
 * Run both producers over `fixture` and collect every name they emit.
 */
async function renderFixture(fixture: FixtureInput): Promise<Rendered> {

    const {
        generatePostgresDdl,
        generatePostgresSearchDdl,
        generatePostgresVectorDdl,
        generatePostgresTriggersDdl,
        generatePostgresViewsDdl,
        planCollectionPolicies,
        planRelationalColumns,
        planJunctionTables
    } = await import(`${ROOT}/packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts`);
    const { planTableSchemaEnsure } =
        await import(`${ROOT}/packages/server-postgres/src/schema/ensure-tables.ts`);
    const { planSchema } = await import(`${ROOT}/packages/server-postgres/src/schema/plan/plan-schema.ts`);
    const { renderViewsDdl } = await import(`${ROOT}/packages/server-postgres/src/schema/plan/render-ddl.ts`);

    const surface: Surface = new Map();

    // `db push`: every file it writes, not just `schema.sql`. The search and
    // vector objects are Atlas-excluded and applied from their own files, so a
    // renderer reading only the desired state would report them boot-only —
    // which this file's own header calls a defect — and would miss
    // `CREATE EXTENSION vector` entirely, since that is the one statement
    // `schema.sql` must never carry.
    const pushDdl: string = await generatePostgresDdl(fixture, {
        includePolicies: true,
        includeSearch: false,
        includeVector: false
    });
    const pushFiles = [
        pushDdl,
        generatePostgresSearchDdl(fixture) as string,
        generatePostgresVectorDdl(fixture, { extensions: FIXTURE_DATABASE_EXTENSIONS }) as string
    ];
    for (const file of pushFiles) {
        for (const statement of statementsOf(file)) readStatement(surface, "push", statement);
    }
    // `triggers.sql` and `views.sql`, the other two files `db push` writes and
    // Atlas is not shown. Read after the first three so that adding them, when
    // the fixture first carried a trigger and a view, moved no existing line.
    for (const statement of statementsOf(generatePostgresTriggersDdl(fixture) as string)) {
        readStatement(surface, "push", statement);
    }
    for (const statement of viewStatementsOf(generatePostgresViewsDdl(fixture) as string)) {
        readStatement(surface, "push", statement);
    }

    // Boot, against a database with nothing in it — the managed first-deploy
    // case, and the only starting state where boot emits its full surface.
    const emptyDb = { tables: new Map(), enums: new Set(), constraints: new Set() };
    for (const action of planTableSchemaEnsure(fixture, emptyDb, {
        databaseExtensions: FIXTURE_DATABASE_EXTENSIONS
    }).actions) {
        readStatement(surface, "boot", action.sql);
    }
    for (const plan of planCollectionPolicies(fixture)) {
        for (const statement of plan.policyStatements) readStatement(surface, "boot", statement);
    }
    // The boot's admin-request companions — `TO rebase_admin_request USING
    // (true)` beside each policy written `TO rebase_admin` — which it plans
    // only once it has made that role, and which no file `db push` writes
    // carries. Planned again with both roles available; the policies they sit
    // beside come out identical, so only the companions are new lines.
    for (const plan of planCollectionPolicies(fixture, { adminRoleAvailable: true, adminRequestRoleAvailable: true })) {
        for (const statement of plan.policyStatements) readStatement(surface, "boot", statement);
    }
    // Views are applied at boot from the same plan, by the same renderer
    // `views.sql` is written with (`ensureTables`).
    const bootPlan = planSchema(fixture, { databaseExtensions: FIXTURE_DATABASE_EXTENSIONS });
    for (const statement of viewStatementsOf(renderViewsDdl(bootPlan) as string)) {
        readStatement(surface, "boot", statement);
    }

    // The legacy names. These are not emitted — they are what boot-ensure
    // RECOGNISES in an aged database in order to rename it, so they are every
    // bit as frozen as the current ones: drop one and an aged database silently
    // gets a second, empty column beside its populated one.
    const legacy: string[] = [];
    for (const plan of planRelationalColumns(fixture)) {
        if (plan.legacyColumn) {
            legacy.push(`legacy-column ${plan.schema}.${plan.table}.${plan.column} <- ${plan.legacyColumn}`);
        }
    }
    for (const plan of planJunctionTables(fixture)) {
        for (const column of plan.columns) {
            if (column.legacyName) {
                legacy.push(`legacy-column ${plan.schema}.${plan.table}.${column.name} <- ${column.legacyName}`);
            }
        }
    }

    return { surface, legacy };
}

/** A surface as baseline lines: `<kind> <id> [<producers>]`, legacy names appended, sorted. */
const linesOf = ({ surface, legacy }: Rendered): string[] => [...surface.entries()]
    .map(([key, producers]) => `${key} [${[...producers].sort().join(",")}]`)
    .concat([...legacy].sort())
    .sort((a, b) => a.localeCompare(b, "en"));

/**
 * The fixture as tables: lifted with `collectionsToTableDefs` (the codemod's
 * own conversion) and compiled with `compileSchema`, exactly as `loadTables`
 * compiles a project's `backend/schema`. Lifted at run time rather than
 * hand-copied, so the tables can never drift from the fixture they come from.
 * (The planner reads only compiled tables, so the collection fixture and its
 * table-shaped twin — once rendered side by side here and required to agree —
 * are one input now.)
 */
async function tableShapedFixture(): Promise<FixtureInput> {
    const { compileSchema } = await import("@rebasepro/common");
    const { collectionsToTableDefs } = await import("@rebasepro/common/migrate");
    const lifted = collectionsToTableDefs(FIXTURE);
    return compileSchema(lifted.tables, lifted.defaultRls !== undefined ? { defaultRls: lifted.defaultRls } : {});
}

export async function render(): Promise<string> {
    await assertResolvesToSource();

    const lines = linesOf(await renderFixture(await tableShapedFixture()));

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
        "# its schemas, but in the applier (ensure-tables.ts, the",
        "# `CREATE SCHEMA IF NOT EXISTS` before the plan runs) rather than in the",
        "# plan this renders. Any OTHER push-only or boot-only line is a defect.",
        "#",
        "# A second exception, by design: the admin-request companions",
        "# (`<policy>_ar_<sha8>`) are boot-only. The boot plans them only once it has",
        "# made `rebase_admin_request`, and no file `db push` writes may carry one.",
        "#",
        "# Fixed (2026-11-12): the touch trigger of an `on_update` column on a",
        "# junction's `through.properties` (`players_teams_changed_at_touch`) was",
        "# written to `triggers.sql` and never planned by the boot. The boot plans it",
        "# now: an ADDED boot producer on an unchanged name.",
        "#",
        "# Every line is rendered from the collection fixture lifted into",
        "# `defineTable` and compiled — the compiled tables every door hands the",
        "# planner. (Until 0.31 it was rendered from the collections as well, and",
        "# the gate refused to render when the two differed; they never did.)",
        "#",
        "# Moved on purpose (2026-11-12): the `<table>_{insert,update,delete}_<sha7>`",
        "# policies of the fixture's bare `access: \"authenticated\"` rule (categories,",
        "# products, shop.inventory_items). That rule was never a typed rule shape: it",
        "# compiled to deny-all. From this version it means any signed-in caller, a",
        "# new shape named in the `rls2:` hash space, so its names moved with it.",
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
