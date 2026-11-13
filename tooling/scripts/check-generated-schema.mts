/**
 * Is this repository's own generated Drizzle schema stale?
 *
 * `backend/src/schema.generated.ts` is checked in, and it can stop describing
 * the schema the runtime expects **without anybody editing anything**. That is
 * the whole trap: 0.13 derives `category_id` where 0.12 derived `categorie_id`,
 * from the same unedited table, so the schema watcher never fires.
 * Boot-ensure renames the column in the database, relation validation then reads
 * the stale module and refuses to start — on that boot and every boot after it,
 * because the rename is already applied and will not be attempted again.
 *
 * `rebase schema stale` answers exactly this question and `rebase dev` runs it
 * with `--fix`, which covers a developer's machine. Nothing ran it against
 * *this* repository, whose `app/backend/src/schema.generated.ts` is the file
 * that broke every deploy once already — and which is also the fixture the
 * self-host acceptance gate builds its bundle from.
 *
 * Two questions, both about *names* rather than bytes — "is this byte-for-byte
 * what the generator would emit now" would report every whitespace change in the
 * generator as fatal staleness, and a check that cries wolf gets switched off:
 *
 *   1. does the generated schema name a foreign key the way a previous release's
 *      rule did? (the upgrade trap above);
 *   2. does it declare every table and derived foreign-key column the
 *      tables name? (the ordinary one — a table or relation was added and the
 *      generator was not re-run).
 *
 * The second is what gives this gate content. On this repository today the first
 * has nothing to catch: no relation here has a name the 0.12 and 0.13 rules
 * disagree about, so on its own it would be a green light for an unchecked file.
 *
 *     pnpm check:schema-fresh
 *
 * The tables are read from `backend/schema` by the driver's own loader
 * (`loadTableSchema`: the server's `loadBackendSchema`, compiled, in slug order), so
 * this gate sees exactly what `rebase schema generate` generates from.
 *
 * Fixing a failure is `rebase schema stale --fix` in `app/backend`, then commit
 * the regenerated file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTableSchema } from "../../packages/server-postgres/src/schema/load-tables.ts";
import {
    findLegacyForeignKeyNames,
    describeLegacyForeignKeyNames,
    findMissingGeneratedNames,
    describeMissingGeneratedNames
} from "../../packages/server-postgres/src/schema/generated-schema-staleness.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every checked-in generated schema, with the schema directory it was generated from. */
const TARGETS = [
    {
        schema: path.join(ROOT, "app", "backend", "src", "schema.generated.ts"),
        tables: path.join(ROOT, "app", "backend", "schema")
    }
];

const rel = (p: string): string => path.relative(ROOT, p);

let failed = false;

for (const target of TARGETS) {
    // A missing generated schema is not staleness. A project that has never run
    // the generator has nothing to be stale, and saying otherwise sends the
    // reader looking for a file to fix.
    if (!fs.existsSync(target.schema)) {
        console.log(`  skip ${rel(target.schema)} — not generated`);
        continue;
    }

    // A schema the loader refuses (a module that does not import, a table
    // with no `rls`…) throws here, and the gate fails with it: there is no
    // way to say whether a file is fresh against tables that cannot be read.
    let descriptors: Awaited<ReturnType<typeof loadTableSchema>>["descriptors"];
    try {
        descriptors = (await loadTableSchema(target.tables)).descriptors;
    } catch (error) {
        console.error(`✗ ${rel(target.tables)} could not be read — nothing was checked:\n`);
        console.error(error instanceof Error ? error.message : String(error));
        failed = true;
        continue;
    }
    if (descriptors.length === 0) {
        // Loud rather than silent: zero tables makes every check below
        // vacuous, and a gate that passes because it found nothing to check is
        // worse than no gate.
        console.error(`✗ No tables loaded from ${rel(target.tables)} — nothing was checked.`);
        failed = true;
        continue;
    }

    const source = fs.readFileSync(target.schema, "utf8");
    const stale = findLegacyForeignKeyNames(source, descriptors);
    const missing = findMissingGeneratedNames(source, descriptors);

    if (stale.length === 0 && missing.length === 0) {
        console.log(`  ok   ${rel(target.schema)} — ${descriptors.length} table(s)`);
        continue;
    }

    failed = true;
    console.error(`\n✗ ${rel(target.schema)} is stale:\n`);
    if (stale.length > 0) console.error(describeLegacyForeignKeyNames(stale));
    if (missing.length > 0) console.error(describeMissingGeneratedNames(missing));
}

if (failed) {
    console.error(
        "\nRegenerate it: `rebase schema stale --fix` from the backend directory, then commit the result."
    );
    process.exit(1);
}

console.log("\n✓ Generated schemas name their foreign keys the way this release derives them.");
