import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { declaredDatabaseExtensions, parseEnvBoolean } from "@rebasepro/types";
import { loadTables } from "./load-tables";
import { generateSchema } from "./generate-drizzle-schema-logic";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    generatePostgresSearchDdl,
    generatePostgresTriggersDdl,
    generatePostgresViewsDdl,
    generatePostgresVectorDdl
} from "./generate-postgres-ddl-logic";
import { describeFailure, out, outError } from "../cli-output";
import { nextStepAfterGenerate } from "./generate-next-step";

/**
 * The two generators `rebase db push` runs as its step 1, as functions.
 *
 * They used to exist only as scripts, each its own `tsx` process: the driver
 * (itself a `tsx` process) spawned one for the Drizzle schema and then one for
 * the DDL, and each paid a Node start, tsx's loader and an import of the whole
 * server package before reading a single table — about 0.5 s apiece, a
 * second per push. The driver process is one-shot, so a fresh module graph per
 * generation bought nothing: the tables cannot change under it.
 *
 * The scripts remain (`generate-drizzle-schema.ts`, `generate-postgres-ddl.ts`)
 * for `--watch`, which re-imports the tables on every save and does need a
 * process of its own — Node's module cache would serve it the first version
 * forever.
 *
 * Both functions print their own success lines and their own error, exactly as
 * the scripts did, and throw {@link GenerationFailed} after printing — so a
 * caller can tell "the generator said why" from "the generator never ran".
 */

/** Thrown once the generator has printed why it failed. */
export class GenerationFailed extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "GenerationFailed";
    }
}

export interface GenerateFileOptions {
    /** The schema directory (`backend/schema`: its index exports the tables), resolved against the cwd. */
    schemaDir: string;
    /** Where to write. Absent: print to stdout instead. */
    outputPath?: string;
    /**
     * End on the line that says what to run next. Only `rebase schema
     * generate` itself wants it: inside `db push` it told the push to run
     * `db generate`, and inside `db generate` to run itself.
     */
    nextStep?: boolean;
}

/** `src/schema.generated.ts`, from the tables. */
export async function writeDrizzleSchema(options: GenerateFileOptions): Promise<void> {
    try {
        // Shared with the runtime and the doctor (`loadTables`), in slug order so
        // the output does not depend on the index's export order.
        const tables = await loadTables(options.schemaDir);
        const schemaContent = generateSchema(tables);

        if (options.outputPath) {
            await fsPromises.mkdir(path.dirname(options.outputPath), { recursive: true });
            await fsPromises.writeFile(options.outputPath, schemaContent);
            out(`✅ Drizzle schema generated successfully at ${options.outputPath}`);
        } else {
            out("✅ Drizzle schema generated successfully.");
            out(String(schemaContent));
        }

        // Inside `rebase init`, which closes on its own next steps.
        if (options.nextStep !== false && parseEnvBoolean(process.env.REBASE_INIT_SCAFFOLD) !== true) out(nextStepAfterGenerate());
    } catch (error) {
        outError(`Error generating schema: ${describeFailure(error)}`);
        // `rebase db push` runs this as step 1 and must stop on it: going on
        // applied whatever `src/schema.generated.ts` was already there.
        throw new GenerationFailed("Drizzle schema generation failed", { cause: error });
    }
}

/** Where a project declares its resources, relative to `backend/` (the schema directory's parent). */
const RESOURCE_ENTRIES = ["resources.ts", "resources.js", "resources/index.ts", "resources/index.js"];

/**
 * Evaluate the project's `resources.ts`, so `declaredDatabaseExtensions()` can
 * answer.
 *
 * The DDL generator loads only the schema directory, so nothing else in it
 * would ever import the resources module — and a permission that reads as
 * absent because nobody loaded it is the worst shape this could take: the push
 * succeeds, `vector.sql` quietly omits the `CREATE EXTENSION`, and the failure
 * lands one statement later looking like a database problem.
 *
 * Imported directly rather than through the config index, for the reason
 * `boot/resource-loading.ts` gives: re-exporting from the index would work only
 * for projects that remember to.
 *
 * A project with no resources module is the normal case and declares nothing.
 * An import that *throws* is not swallowed — a resources module that does not
 * evaluate is a configuration error, and treating it as "declared nothing"
 * would turn it into a silently missing extension.
 */
async function loadDeclaredResources(backendDir: string): Promise<void> {
    const entry = RESOURCE_ENTRIES
        .map(name => path.join(backendDir, name))
        .find(candidate => fs.existsSync(candidate));
    if (!entry) return;
    await import(pathToFileURL(entry).href);
}

/** A column whose DEFAULT calls one of Rebase's own `rebase.*` functions. */
export interface RebaseFunctionDefault {
    table: string;
    column: string;
    expression: string;
}

/**
 * The columns in `schema.sql` whose DEFAULT calls a `rebase.*` function, such
 * as `DEFAULT rebase.uid()`.
 *
 * Atlas cannot build them. It runs `schema.sql` in an empty scratch database,
 * where there is no `rebase` schema, and it refuses both ways of providing
 * one: a scratch database that is not empty ("connected database is not
 * clean"), and `CREATE FUNCTION` in the desired state on its free tier. So
 * `db push` died inside Atlas with "function rebase.uid() does not exist",
 * though the real database had the function (reported from a Supabase
 * migration, 2026-11-18). It is refused here instead, naming the column and
 * what to write.
 */
export function rebaseFunctionDefaults(ddl: string): RebaseFunctionDefault[] {
    const found: RebaseFunctionDefault[] = [];
    const tableRe = /CREATE TABLE(?: IF NOT EXISTS)?\s+((?:"[^"]+"\.)?"[^"]+")\s*\(([\s\S]*?)\n\);/g;
    let table: RegExpExecArray | null;
    while ((table = tableRe.exec(ddl)) !== null) {
        for (const line of table[2].split("\n")) {
            const column = /^\s*"([^"]+)"\s.*?\bDEFAULT\s+(.*?),?\s*$/.exec(line);
            // String literals out first: a default that only mentions the
            // function in text calls nothing.
            if (column && /\brebase\.\w+\s*\(/.test(column[2].replace(/'(?:[^']|'')*'/g, "''"))) {
                found.push({ table: table[1].replace(/"/g, ""), column: column[1], expression: column[2] });
            }
        }
    }
    return found;
}

/** The refusal for {@link rebaseFunctionDefaults}, or undefined when there is none. */
export function rebaseFunctionDefaultsProblem(ddl: string): string | undefined {
    const found = rebaseFunctionDefaults(ddl);
    if (found.length === 0) return undefined;
    return [
        `${found.length === 1 ? "A column's DEFAULT calls" : `${found.length} columns' DEFAULTs call`} a Rebase function, which the schema planner (Atlas) cannot build:`,
        ...found.map((f) => `  - ${f.table}.${f.column}  DEFAULT ${f.expression}`),
        "For the caller's id, declare the column `.onCreateUser()` (or `.onUpdateUser()`) instead of `.default(sql`rebase.uid()`)`: the server writes it.",
        "For anything else, set the value in the table's `hooks: { beforeSave }`."
    ].join("\n");
}

/**
 * `schema.sql` (Atlas's desired state) and, beside it, `policies.sql`,
 * `search.sql`, `vector.sql`, `triggers.sql` and `views.sql` — the parts Atlas
 * does not own.
 */
export async function writePostgresDdl(options: GenerateFileOptions): Promise<void> {
    try {
        const resolvedPath = path.resolve(options.schemaDir);

        // `backend/schema` is the path this is given, so `backend/` — where
        // `resources.ts` lives — is its parent: the same relationship
        // `rebase resources` and the boot loader assume.
        await loadDeclaredResources(path.dirname(resolvedPath));

        const tables = await loadTables(resolvedPath);

        // `schema.sql` is Atlas's desired state, and it carries neither the RLS
        // policies, nor the search apparatus, nor the vector columns: Atlas
        // manages none of them, and in the search and vector cases cannot. All
        // three are written beside it and applied by the CLI in their own right.
        const ddlContent = generatePostgresDdl(tables, {
            includePolicies: false,
            includeSearch: false,
            includeVector: false
        });
        const functionDefaults = rebaseFunctionDefaultsProblem(ddlContent);
        if (functionDefaults) throw new Error(functionDefaults);
        const policiesContent = generatePostgresPoliciesDdl(tables);
        const searchContent = generatePostgresSearchDdl(tables);
        const vectorContent = generatePostgresVectorDdl(tables, {
            extensions: declaredDatabaseExtensions()
        });
        const triggersContent = generatePostgresTriggersDdl(tables);
        const viewsContent = generatePostgresViewsDdl(tables);

        const outputPath = options.outputPath;
        if (outputPath) {
            const outputDir = path.dirname(outputPath);
            await fsPromises.mkdir(outputDir, { recursive: true });
            await fsPromises.writeFile(outputPath, ddlContent);
            out(`✅ PostgreSQL DDL generated successfully at ${outputPath}`);

            const policiesPath = path.join(outputDir, "policies.sql");
            await fsPromises.writeFile(policiesPath, policiesContent);
            out(`✅ PostgreSQL Policies DDL generated successfully at ${policiesPath}`);

            // Removed when the last `search` block goes: the CLI applies this
            // file whenever it exists, and a stale one would keep re-creating
            // functions for tables that no longer want them.
            const searchPath = path.join(outputDir, "search.sql");
            if (searchContent) {
                await fsPromises.writeFile(searchPath, searchContent);
                out(`✅ PostgreSQL search DDL generated successfully at ${searchPath}`);
            } else if (fs.existsSync(searchPath)) {
                await fsPromises.rm(searchPath);
            }

            // Removed when the last vector column goes, for the same reason
            // `search.sql` is: the CLI applies whichever of these files exists,
            // and a stale one would keep re-adding a column the tables no
            // longer declare — which Atlas, no longer told to exclude it, would
            // then plan a DROP for on the very next push.
            const vectorPath = path.join(outputDir, "vector.sql");
            if (vectorContent) {
                await fsPromises.writeFile(vectorPath, vectorContent);
                out(`✅ PostgreSQL vector DDL generated successfully at ${vectorPath}`);
            } else if (fs.existsSync(vectorPath)) {
                await fsPromises.rm(vectorPath);
            }

            // `.onUpdateNow()` (`autoValue: "on_update"`), on the same terms as the two above: a
            // trigger is a function plus a binding, which Atlas's free tier
            // will not parse, and a stale file would keep re-installing a
            // trigger for a column nothing declares any more.
            const triggersPath = path.join(outputDir, "triggers.sql");
            if (triggersContent) {
                await fsPromises.writeFile(triggersPath, triggersContent);
                out(`✅ PostgreSQL trigger DDL generated successfully at ${triggersPath}`);
            } else if (fs.existsSync(triggersPath)) {
                await fsPromises.rm(triggersPath);
            }

            // The schema's views (`defineView`), which Atlas's free tier does not manage.
            // Removed with the last view, as the others are: the CLI applies
            // the file whenever it exists.
            const viewsPath = path.join(outputDir, "views.sql");
            if (viewsContent) {
                await fsPromises.writeFile(viewsPath, viewsContent);
                out(`✅ PostgreSQL view DDL generated successfully at ${viewsPath}`);
            } else if (fs.existsSync(viewsPath)) {
                await fsPromises.rm(viewsPath);
            }
        } else {
            out("✅ PostgreSQL DDL generated successfully.");
            out(String(ddlContent));
            out("\n✅ PostgreSQL Policies DDL generated successfully.");
            out(String(policiesContent));
        }
    } catch (error) {
        outError(`Error generating DDL schema: ${describeFailure(error)}`);
        // Step 1 of `rebase db push` is this, and a failure has to stop it.
        // Going on made a resources module that does not evaluate — the single
        // most common cause here — report `✓ rebase db push completed
        // successfully` while Atlas applied whatever `drizzle/schema.sql`
        // happened to be on disk, sometimes minutes old. With no prior file the
        // same run died inside Atlas on `stat drizzle/schema.sql: no such file
        // or directory`, which hides the real cause two screens up.
        throw new GenerationFailed("Postgres DDL generation failed", { cause: error });
    }
}
