import path from "path";
import { out } from "../cli-output";
import { writePostgresDdl } from "./generate-files";

/**
 * The generator as its own process — what `--watch` runs, because a watch has
 * to re-import the tables on every save and Node's module cache would
 * serve it the first version forever. One-shot generation runs in the driver's
 * own process instead; see `generate-files.ts`.
 */
const runGeneration = async (schemaDir?: string, outputPath?: string, ptahOutputPath?: string) => {
    if (!schemaDir) {
        throw new Error("No schema directory provided.");
    }
    try {
        await writePostgresDdl({ schemaDir: path.resolve(schemaDir), outputPath, ptahOutputPath });
    } catch (error) {
        // A caller that reads nothing but this process's exit code must not
        // see 0 after an error was printed — see `writePostgresDdl`.
        process.exitCode = 1;
        throw error;
    }
};

export const main = async () => {
    const schemaDirArg = process.argv.find(arg => arg.startsWith("--schema-dir="));
    const schemaDir = schemaDirArg ? schemaDirArg.split("=")[1] : process.argv[2];

    const outputPathArg = process.argv.find(arg => arg.startsWith("--output="));
    const outputPath = outputPathArg ? outputPathArg.split("=")[1] : undefined;

    const ptahOutputPathArg = process.argv.find(arg => arg.startsWith("--ptah-output="));
    const ptahOutputPath = ptahOutputPathArg ? ptahOutputPathArg.split("=")[1] : undefined;

    const watch = process.argv.includes("--watch");

    if (!schemaDir) {
        out("Usage: ts-node generate-postgres-ddl.ts --schema-dir=<backend/schema> [--output=<path-to-output-file>] [--watch]");
        return;
    }

    const resolvedPath = path.resolve(process.cwd(), schemaDir);
    const resolvedOutputPath = outputPath ? path.resolve(process.cwd(), outputPath) : undefined;
    const resolvedPtahOutputPath = ptahOutputPath ? path.resolve(process.cwd(), ptahOutputPath) : undefined;

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
        // An authoring-only dependency does not belong on a boot path.
        const { default: chokidar } = await import("chokidar");
        const watcher = chokidar.watch(resolvedPath, {
            persistent: true,
            ignoreInitial: false
        });

        watcher.on("all", (event, filePath) => {
            out(`[${event}] ${filePath}. Regenerating DDL schema...`);
            // A watch session outlives a bad edit: the cause is already on
            // stderr, and the next save is the retry. Only the one-shot run
            // below turns a failure into an exit code.
            void runGeneration(resolvedPath, resolvedOutputPath, resolvedPtahOutputPath).catch(() => undefined);
        });
    } else {
        await runGeneration(resolvedPath, resolvedOutputPath, resolvedPtahOutputPath);
    }
};

// This check ensures the script only runs when executed directly
if (import.meta.url.endsWith(process.argv[1])) {
    // `runGeneration` has already printed the cause and set the exit code; the
    // handler is here so the last thing on the terminal is that message rather
    // than Node's unhandled-rejection dump of the same stack.
    main().catch(() => {
        process.exitCode = 1;
    });
}
