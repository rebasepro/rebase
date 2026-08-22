import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { generateSchema } from "./generate-drizzle-schema-logic";
import { CollectionConfig } from "@rebasepro/types";
import { loadCollectionsFromDirectory } from "@rebasepro/server";
import { out, outError } from "../cli-output";


// --- Helper Functions ---

const formatTerminalText = (text: string, options: {
    bold?: boolean;
    backgroundColor?: "blue" | "green" | "red" | "yellow" | "cyan" | "magenta";
    textColor?: "white" | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan";
} = {}): string => {
    let codes = "";
    if (options.bold) codes += "\x1b[1m";
    if (options.backgroundColor) {
        const bgColors = {
            blue: "\x1b[44m",
            green: "\x1b[42m",
            red: "\x1b[41m",
            yellow: "\x1b[43m",
            cyan: "\x1b[46m",
            magenta: "\x1b[45m"
        } as const;
        codes += bgColors[options.backgroundColor];
    }
    if (options.textColor) {
        const textColors = {
            white: "\x1b[37m",
            black: "\x1b[30m",
            red: "\x1b[31m",
            green: "\x1b[32m",
            yellow: "\x1b[33m",
            blue: "\x1b[34m",
            magenta: "\x1b[35m",
            cyan: "\x1b[36m"
        } as const;
        codes += textColors[options.textColor];
    }
    return `${codes}${text}\x1b[0m`;
};

// --- Execution and Watch Logic ---

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

        out(`You can now run ${formatTerminalText("rebase db generate", {
            bold: true,
            backgroundColor: "blue",
            textColor: "black"
        })} to generate the SQL migration files.`);

    } catch (error) {
        outError(`Error generating schema: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
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
