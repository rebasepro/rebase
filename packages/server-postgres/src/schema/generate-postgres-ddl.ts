import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import chokidar from "chokidar";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    generatePostgresSearchDdl
} from "./generate-postgres-ddl-logic";
import { CollectionConfig } from "@rebasepro/types";
import { logger, loadCollectionsFromDirectory } from "@rebasepro/server";


const runGeneration = async (collectionsFilePath?: string, outputPath?: string) => {
    try {
        if (!collectionsFilePath) {
            logger.error("Error: No collections file path provided. Skipping schema generation.");
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
            logger.info(`✅ PostgreSQL DDL generated successfully at ${outputPath}`);

            const policiesPath = path.join(outputDir, "policies.sql");
            await fsPromises.writeFile(policiesPath, policiesContent);
            logger.info(`✅ PostgreSQL Policies DDL generated successfully at ${policiesPath}`);

            // Removed when the last `search` block goes: the CLI applies this
            // file whenever it exists, and a stale one would keep re-creating
            // functions for collections that no longer want them.
            const searchPath = path.join(outputDir, "search.sql");
            if (searchContent) {
                await fsPromises.writeFile(searchPath, searchContent);
                logger.info(`✅ PostgreSQL search DDL generated successfully at ${searchPath}`);
            } else if (fs.existsSync(searchPath)) {
                await fsPromises.rm(searchPath);
            }
        } else {
            logger.info("✅ PostgreSQL DDL generated successfully.");
            logger.info(String(ddlContent));
            logger.info("\n✅ PostgreSQL Policies DDL generated successfully.");
            logger.info(String(policiesContent));
        }

    } catch (error) {
        logger.error("Error generating DDL schema", { error: error });
    }
};

const main = () => {
    const collectionsFilePathArg = process.argv.find(arg => arg.startsWith("--collections="));
    const collectionsFilePath = collectionsFilePathArg ? collectionsFilePathArg.split("=")[1] : process.argv[2];

    const outputPathArg = process.argv.find(arg => arg.startsWith("--output="));
    const outputPath = outputPathArg ? outputPathArg.split("=")[1] : undefined;

    const watch = process.argv.includes("--watch");

    if (!collectionsFilePath) {
        logger.info("Usage: ts-node generate-postgres-ddl.ts <path-to-collections-file> [--output <path-to-output-file>] [--watch]");
        return;
    }

    const resolvedPath = path.resolve(process.cwd(), collectionsFilePath);
    const resolvedOutputPath = outputPath ? path.resolve(process.cwd(), outputPath) : undefined;

    if (watch) {
        logger.info(`Watching for changes in ${resolvedPath}...`);
        const watcher = chokidar.watch(resolvedPath, {
            persistent: true,
            ignoreInitial: false
        });

        watcher.on("all", (event, filePath) => {
            logger.info(`[${event}] ${filePath}. Regenerating DDL schema...`);
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
