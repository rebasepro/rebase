import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { CollectionConfig, declaredDatabaseExtensions } from "@rebasepro/types";
import { loadCollectionsFromDirectory } from "@rebasepro/server";
import { generateSchema } from "./generate-drizzle-schema-logic";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    generatePostgresSearchDdl,
    generatePostgresTriggersDdl,
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
 * server package before reading a single collection — about 0.5 s apiece, a
 * second per push. The driver process is one-shot, so a fresh module graph per
 * generation bought nothing: the collections cannot change under it.
 *
 * The scripts remain (`generate-drizzle-schema.ts`, `generate-postgres-ddl.ts`)
 * for `--watch`, which re-imports the collections on every save and does need a
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
    /** The collections directory (or single module), resolved against the cwd. */
    collectionsPath: string;
    /** Where to write. Absent: print to stdout instead. */
    outputPath?: string;
    /**
     * End on the line that says what to run next. Only `rebase schema
     * generate` itself wants it: inside `db push` it told the push to run
     * `db generate`, and inside `db generate` to run itself.
     */
    nextStep?: boolean;
}

/** The collections, in slug order so the output does not depend on the directory's. */
async function loadSortedCollections(collectionsPath: string): Promise<CollectionConfig[]> {
    // Shared with the runtime and the doctor: what gets generated here must
    // be exactly what the server serves, including directory-level defaults.
    const loaded = await loadCollectionsFromDirectory(path.resolve(collectionsPath));
    // A copy: the loader's array is its caller's, and in-process the same
    // collections are read again by the steps after this one.
    const collections: CollectionConfig[] = Array.isArray(loaded) ? [...loaded] : [];
    collections.sort((a, b) => a.slug.localeCompare(b.slug));
    return collections;
}

/** `src/schema.generated.ts`, from the collections. */
export async function writeDrizzleSchema(options: GenerateFileOptions): Promise<void> {
    try {
        const collections = await loadSortedCollections(options.collectionsPath);
        const schemaContent = generateSchema(collections);

        if (options.outputPath) {
            await fsPromises.mkdir(path.dirname(options.outputPath), { recursive: true });
            await fsPromises.writeFile(options.outputPath, schemaContent);
            out(`✅ Drizzle schema generated successfully at ${options.outputPath}`);
        } else {
            out("✅ Drizzle schema generated successfully.");
            out(String(schemaContent));
        }

        if (options.nextStep !== false) out(nextStepAfterGenerate());
    } catch (error) {
        outError(`Error generating schema: ${describeFailure(error)}`);
        // `rebase db push` runs this as step 1 and must stop on it: going on
        // applied whatever `src/schema.generated.ts` was already there.
        throw new GenerationFailed("Drizzle schema generation failed", { cause: error });
    }
}

/** Where a project declares its resources, relative to the config directory. */
const RESOURCE_ENTRIES = ["resources.ts", "resources.js", "resources/index.ts", "resources/index.js"];

/**
 * Evaluate the project's `resources.ts`, so `declaredDatabaseExtensions()` can
 * answer.
 *
 * The DDL generator loads only the collections directory, so nothing else in it
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
async function loadDeclaredResources(configDir: string): Promise<void> {
    const entry = RESOURCE_ENTRIES
        .map(name => path.join(configDir, name))
        .find(candidate => fs.existsSync(candidate));
    if (!entry) return;
    await import(pathToFileURL(entry).href);
}

/**
 * `schema.sql` (Atlas's desired state) and, beside it, `policies.sql`,
 * `search.sql`, `vector.sql` and `triggers.sql` — the parts Atlas does not own.
 */
export async function writePostgresDdl(options: GenerateFileOptions): Promise<void> {
    try {
        const resolvedPath = path.resolve(options.collectionsPath);

        // `<config>/collections` is the path this is given, so the config
        // directory is its parent — the same relationship `rebase resources`
        // and the boot loader assume.
        await loadDeclaredResources(path.dirname(resolvedPath));

        const collections = await loadSortedCollections(resolvedPath);

        // `schema.sql` is Atlas's desired state, and it carries neither the RLS
        // policies, nor the search apparatus, nor the vector columns: Atlas
        // manages none of them, and in the search and vector cases cannot. All
        // three are written beside it and applied by the CLI in their own right.
        const ddlContent = generatePostgresDdl(collections, {
            includePolicies: false,
            includeSearch: false,
            includeVector: false
        });
        const policiesContent = generatePostgresPoliciesDdl(collections);
        const searchContent = generatePostgresSearchDdl(collections);
        const vectorContent = generatePostgresVectorDdl(collections, {
            extensions: declaredDatabaseExtensions()
        });
        const triggersContent = generatePostgresTriggersDdl(collections);

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
            // functions for collections that no longer want them.
            const searchPath = path.join(outputDir, "search.sql");
            if (searchContent) {
                await fsPromises.writeFile(searchPath, searchContent);
                out(`✅ PostgreSQL search DDL generated successfully at ${searchPath}`);
            } else if (fs.existsSync(searchPath)) {
                await fsPromises.rm(searchPath);
            }

            // Removed when the last `vector` property goes, for the same reason
            // `search.sql` is: the CLI applies whichever of these files exists,
            // and a stale one would keep re-adding a column the collections no
            // longer declare — which Atlas, no longer told to exclude it, would
            // then plan a DROP for on the very next push.
            const vectorPath = path.join(outputDir, "vector.sql");
            if (vectorContent) {
                await fsPromises.writeFile(vectorPath, vectorContent);
                out(`✅ PostgreSQL vector DDL generated successfully at ${vectorPath}`);
            } else if (fs.existsSync(vectorPath)) {
                await fsPromises.rm(vectorPath);
            }

            // `autoValue: "on_update"`, on the same terms as the two above: a
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
