import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import chokidar from "chokidar";
import { generatePostgresDdl, generatePostgresPoliciesDdl } from "./generate-postgres-ddl-logic";
import { EntityCollection } from "@rebasepro/types";
import { logger } from "@rebasepro/server-core";


const runGeneration = async (collectionsFilePath?: string, outputPath?: string) => {
    try {
        if (!collectionsFilePath) {
            logger.error("Error: No collections file path provided. Skipping schema generation.");
            return;
        }

        const resolvedPath = path.resolve(collectionsFilePath);
        let collections: EntityCollection[] = [];
        const stats = fs.statSync(resolvedPath);

        if (stats.isDirectory()) {
            const files = fs.readdirSync(resolvedPath);
            for (const file of files) {
                if ((file.endsWith(".ts") || file.endsWith(".js")) &&
                    !file.includes(".test.") &&
                    !file.endsWith(".d.ts") &&
                    file !== "index.ts" && file !== "index.js") {

                    const filePath = path.join(resolvedPath, file);
                    try {
                        const fileUrl = pathToFileURL(filePath).href;
                        const module = await import(fileUrl);
                        if (module && module.default) {
                            collections.push(module.default);
                        }
                    } catch (err: unknown) {
                        const message = err instanceof Error ? err.message : String(err);
                        logger.error(`Error loading ${file}`, { detail: message });
                    }
                }
            }
        } else {
            const fileUrl = pathToFileURL(resolvedPath).href + `?t=${Date.now()}`;
            const imported = await import(fileUrl);
            collections = imported.backendCollections || imported.collections;
        }

        if (!collections || !Array.isArray(collections)) {
            collections = [];
        }

        // Sort collections by slug alphabetically to ensure deterministic DDL generation
        collections.sort((a, b) => a.slug.localeCompare(b.slug));

        const ddlContent = await generatePostgresDdl(collections, { includePolicies: false });
        const policiesContent = generatePostgresPoliciesDdl(collections);

        if (outputPath) {
            const outputDir = path.dirname(outputPath);
            await fsPromises.mkdir(outputDir, { recursive: true });
            await fsPromises.writeFile(outputPath, ddlContent);
            logger.info(`✅ PostgreSQL DDL generated successfully at ${outputPath}`);

            const policiesPath = path.join(outputDir, "policies.sql");
            await fsPromises.writeFile(policiesPath, policiesContent);
            logger.info(`✅ PostgreSQL Policies DDL generated successfully at ${policiesPath}`);
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
