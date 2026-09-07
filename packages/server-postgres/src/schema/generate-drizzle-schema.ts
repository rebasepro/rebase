import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { generateSchema } from "./generate-drizzle-schema-logic";
import { CollectionConfig } from "@rebasepro/types";
import { loadCollectionsFromDirectory } from "@rebasepro/server";
import { out, outError } from "../cli-output";
import { nextStepAfterGenerate } from "./generate-next-step";


// --- Execution and Watch Logic ---

const runGeneration = async (collectionsFilePath?: string, outputPath?: string) => {
    try {
        if (!collectionsFilePath) {
            throw new Error("No collections file path provided.");
        }

        const resolvedPath = path.resolve(collectionsFilePath);

        // Shared with the runtime and the doctor: what gets generated here must
        // be exactly what the server serves, including directory-level defaults.
        let collections: CollectionConfig[] = await loadCollectionsFromDirectory(resolvedPath);


        // If collections directory is empty but exists, or failed to find any, we still want to inject defaults
        if (!collections || !Array.isArray(collections)) {
            collections = [];
        }


        // Sort collections by slug alphabetically to ensure deterministic schema generation
        collections.sort((a, b) => a.slug.localeCompare(b.slug));

        const schemaContent = await generateSchema(collections);

        if (outputPath) {
            const outputDir = path.dirname(outputPath);
            await fsPromises.mkdir(outputDir, { recursive: true });
            await fsPromises.writeFile(outputPath, schemaContent);
            out(`✅ Drizzle schema generated successfully at ${outputPath}`);
        } else {
            out("✅ Drizzle schema generated successfully.");
            out(String(schemaContent));
        }

        out(nextStepAfterGenerate());

    } catch (error) {
        outError(`Error generating schema: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        // The same contract its sibling `generate-postgres-ddl.ts` keeps, and
        // for the same reason: `rebase db push` runs both as step 1 and reads
        // nothing but their exit codes. Exiting 0 after printing an error made
        // the push apply whatever `src/schema.generated.ts` was already there.
        process.exitCode = 1;
        throw error;
    }
};

const main = async () => {
    const collectionsFilePathArg = process.argv.find(arg => arg.startsWith("--collections="));
    const collectionsFilePath = collectionsFilePathArg ? collectionsFilePathArg.split("=")[1] : process.argv[2];

    const outputPathArg = process.argv.find(arg => arg.startsWith("--output="));
    const outputPath = outputPathArg ? outputPathArg.split("=")[1] : undefined;

    const watch = process.argv.includes("--watch");

    if (!collectionsFilePath) {
        out("Usage: ts-node generate-drizzle-schema.ts <path-to-collections-file> [--output <path-to-output-file>] [--watch]");
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
            out(`[${event}] ${filePath}. Regenerating schema...`);
            // A watch session outlives a bad edit; the next save is the retry.
            void runGeneration(resolvedPath, resolvedOutputPath).catch(() => undefined);
        });
    } else {
        await runGeneration(resolvedPath, resolvedOutputPath);
    }
};

// This check ensures the script only runs when executed directly
if (import.meta.url.endsWith(process.argv[1])) {
    // The cause is already on stderr with the exit code set; this keeps Node
    // from printing the same stack again as an unhandled rejection.
    main().catch(() => {
        process.exitCode = 1;
    });
}
