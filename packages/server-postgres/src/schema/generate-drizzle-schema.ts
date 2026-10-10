import path from "path";
import { out } from "../cli-output";
import { writeDrizzleSchema } from "./generate-files";


// --- Execution and Watch Logic ---

/**
 * The generator as its own process — what `--watch` runs, because a watch has
 * to re-import the collections on every save and Node's module cache would
 * serve it the first version forever. One-shot generation runs in the driver's
 * own process instead; see `generate-files.ts`.
 */
const runGeneration = async (collectionsFilePath?: string, outputPath?: string) => {
    if (!collectionsFilePath) {
        throw new Error("No collections file path provided.");
    }
    try {
        await writeDrizzleSchema({ collectionsPath: path.resolve(collectionsFilePath), outputPath });
    } catch (error) {
        // The same contract its sibling `generate-postgres-ddl.ts` keeps, and
        // for the same reason: a caller that reads nothing but this process's
        // exit code must not see 0 after an error was printed.
        process.exitCode = 1;
        throw error;
    }
};

export const main = async () => {
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
