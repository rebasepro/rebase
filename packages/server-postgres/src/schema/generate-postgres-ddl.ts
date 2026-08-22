import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    generatePostgresSearchDdl
} from "./generate-postgres-ddl-logic";
import { CollectionConfig } from "@rebasepro/types";
import { loadCollectionsFromDirectory } from "@rebasepro/server";
import { out, outError } from "../cli-output";


const runGeneration = async (collectionsFilePath?: string, outputPath?: string) => {
    try {
        if (!collectionsFilePath) {
            outError("Error: No collections file path provided. Skipping schema generation.");
            return;
        }

        const resolvedPath = path.resolve(collectionsFilePath);

        // Shared with the runtime and the doctor: what gets generated here must
        // be exactly what the server serves, including directory-level defaults.
        let collections: CollectionConfig[] = await loadCollectionsFromDirectory(resolvedPath);


        if (!collections || !Array.isArray(collections)) {
            collections = [];
        }

        // Sort collections by slug alphabetically to ensure deterministic DDL generation
        collections.sort((a, b) => a.slug.localeCompare(b.slug));

        // `schema.sql` is Atlas's desired state, and it carries neither the RLS
        // policies nor the search apparatus: Atlas manages neither, and in the
        // search case cannot. Both are written beside it and applied by the CLI
        // in their own right.
        const ddlContent = await generatePostgresDdl(collections, {
            includePolicies: false,
            includeSearch: false
        });
        const policiesContent = generatePostgresPoliciesDdl(collections);
        const searchContent = generatePostgresSearchDdl(collections);

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
        /**
         * `chokidar` is imported lazily, inside the branch that watches.
 *
         * It is a file watcher used by `--watch`, and this module is re-exported from
         * the package index — so a static import made a dev-time convenience a hard
         * runtime dependency of the database driver. The runtime image deliberately
         * ships the driver but prunes CLI-only dependencies, so loading it there failed
         * with `Cannot find package 'chokidar'` and the pod could not reach Postgres at
         * all. Found by booting the built image; every unit test was green, because
         * nothing in the suite loads the package the way a container does.
         */
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
