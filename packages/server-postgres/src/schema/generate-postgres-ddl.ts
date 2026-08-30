import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    generatePostgresSearchDdl,
    generatePostgresVectorDdl
} from "./generate-postgres-ddl-logic";
import { CollectionConfig, declaredDatabaseExtensions } from "@rebasepro/types";
import { loadCollectionsFromDirectory } from "@rebasepro/server";
import { out, outError } from "../cli-output";

/** Where a project declares its resources, relative to the config directory. */
const RESOURCE_ENTRIES = ["resources.ts", "resources.js", "resources/index.ts", "resources/index.js"];

/**
 * Evaluate the project's `resources.ts`, so `declaredDatabaseExtensions()` can
 * answer.
 *
 * This generator runs as its own tsx subprocess and loads only the collections
 * directory, so nothing else in it would ever import the resources module — and
 * a permission that reads as absent because nobody loaded it is the worst shape
 * this could take: the push succeeds, `vector.sql` quietly omits the
 * `CREATE EXTENSION`, and the failure lands one statement later looking like a
 * database problem.
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

const runGeneration = async (collectionsFilePath?: string, outputPath?: string) => {
    try {
        if (!collectionsFilePath) {
            outError("Error: No collections file path provided. Skipping schema generation.");
            return;
        }

        const resolvedPath = path.resolve(collectionsFilePath);

        // `<config>/collections` is the path this is given, so the config
        // directory is its parent — the same relationship `rebase resources`
        // and the boot loader assume.
        await loadDeclaredResources(path.dirname(resolvedPath));

        // Shared with the runtime and the doctor: what gets generated here must
        // be exactly what the server serves, including directory-level defaults.
        let collections: CollectionConfig[] = await loadCollectionsFromDirectory(resolvedPath);


        if (!collections || !Array.isArray(collections)) {
            collections = [];
        }

        // Sort collections by slug alphabetically to ensure deterministic DDL generation
        collections.sort((a, b) => a.slug.localeCompare(b.slug));

        // `schema.sql` is Atlas's desired state, and it carries neither the RLS
        // policies, nor the search apparatus, nor the vector columns: Atlas
        // manages none of them, and in the search and vector cases cannot. All
        // three are written beside it and applied by the CLI in their own right.
        const ddlContent = await generatePostgresDdl(collections, {
            includePolicies: false,
            includeSearch: false,
            includeVector: false
        });
        const policiesContent = generatePostgresPoliciesDdl(collections);
        const searchContent = generatePostgresSearchDdl(collections);
        const vectorContent = generatePostgresVectorDdl(collections, {
            extensions: declaredDatabaseExtensions()
        });

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
        } else {
            out("✅ PostgreSQL DDL generated successfully.");
            out(String(ddlContent));
            out("\n✅ PostgreSQL Policies DDL generated successfully.");
            out(String(policiesContent));
        }

    } catch (error) {
        outError(`Error generating DDL schema: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
};

const main = async () => {
    const collectionsFilePathArg = process.argv.find(arg => arg.startsWith("--collections="));
    const collectionsFilePath = collectionsFilePathArg ? collectionsFilePathArg.split("=")[1] : process.argv[2];

    const outputPathArg = process.argv.find(arg => arg.startsWith("--output="));
    const outputPath = outputPathArg ? outputPathArg.split("=")[1] : undefined;

    const watch = process.argv.includes("--watch");

    if (!collectionsFilePath) {
        out("Usage: ts-node generate-postgres-ddl.ts <path-to-collections-file> [--output <path-to-output-file>] [--watch]");
        return;
    }

    const resolvedPath = path.resolve(process.cwd(), collectionsFilePath);
    const resolvedOutputPath = outputPath ? path.resolve(process.cwd(), outputPath) : undefined;

    if (watch) {
        out(`Watching for changes in ${resolvedPath}...`);
        // Imported here rather than at module scope, and this is not a style
        // choice: chokidar is needed only by `--watch`, which is a
        // schema-authoring path that never runs inside the runtime image. A
        // top-level import puts it on the boot path of the published driver
        // bundle, and the image installs a hand-listed set of runtime
        // dependencies that does not include it — so the whole driver failed to
        // load with "Cannot find package 'chokidar'", and every self-hosted
        // container answered 500 with a stack trace about a file watcher.
        //
        // Same reasoning the image already applies to @ariga/atlas: an
        // authoring-only dependency does not belong on a boot path.
        const { default: chokidar } = await import("chokidar");
        const watcher = chokidar.watch(resolvedPath, {
            persistent: true,
            ignoreInitial: false
        });

        watcher.on("all", (event, filePath) => {
            out(`[${event}] ${filePath}. Regenerating DDL schema...`);
            runGeneration(resolvedPath, resolvedOutputPath);
        });
    } else {
        runGeneration(resolvedPath, resolvedOutputPath);
    }
};

// This check ensures the script only runs when executed directly
if (import.meta.url.endsWith(process.argv[1])) {
    main();
}
