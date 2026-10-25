/**
 * Where this project's collections are: one answer for every command.
 *
 * `rebase.json`'s `apps.<backend>.config` names the config package, and the
 * collections live in `<config>/collections`. The dev runtime, `rebase build`
 * and `rebase generate view` honoured it; `verify`, `doctor`, `generate-sdk`,
 * `console`, and dev's watcher and schema/SDK regeneration each hardcoded
 * `config/collections`. In a project with `"config": "shared"` the runtime
 * loaded `shared/collections` while `rebase verify` reported "no collections
 * directory … 0 errors", `generate-sdk` said the API derives from the
 * database, `doctor` found no collections, and dev never regenerated on an
 * edit.
 *
 * A `--collections` typed on the command line still wins wherever a command
 * takes one; this is only the default.
 */
import path from "path";
import { DEFAULT_CONFIG_DIR, findBackendApp, loadManifest, resolveBackendPaths } from "../manifest";

/** The config package directory, relative to the project root, as the backend app declares it. */
export function resolveConfigDir(projectRoot: string): string {
    try {
        const backend = findBackendApp(loadManifest(projectRoot).manifest);
        if (backend) return resolveBackendPaths(backend.app, projectRoot).config;
    } catch {
        // A malformed rebase.json is reported by the commands that own it; the
        // conventional layout is the answer until then.
    }
    return DEFAULT_CONFIG_DIR;
}

/** `<config>/collections`, absolute. */
export function resolveCollectionsDir(projectRoot: string): string {
    return path.join(projectRoot, resolveConfigDir(projectRoot), "collections");
}

/** Whether a command line already names a collections directory. */
function namesCollections(args: readonly string[]): boolean {
    return args.some(arg => arg === "--collections" || arg === "-c" || arg.startsWith("--collections=") || arg.startsWith("-c="));
}

/**
 * The driver commands that read collections and take `--collections` — the
 * driver defaults each of them to `../config/collections` from `backend/`.
 * Keyed as the driver's argv starts: domain, then subcommand.
 */
const DRIVER_COMMANDS_READING_COLLECTIONS = new Set([
    "db push",
    "db generate",
    "schema generate",
    "schema stale",
    "doctor",
    "console"
]);

/**
 * `["--collections", <dir>]` to append to a driver command line, or nothing.
 *
 * `driverArgs` is the line as the driver gets it (`["db", "push", …]`,
 * `["doctor", …]`). Nothing for a command that does not read collections, nothing
 * when the line already names a directory, and nothing when the project keeps
 * its collections where the driver looks by default, so a conventional
 * project's command lines are unchanged.
 */
export function collectionsDirArgs(projectRoot: string, driverArgs: readonly string[]): string[] {
    const command = DRIVER_COMMANDS_READING_COLLECTIONS.has(driverArgs[0])
        ? driverArgs[0]
        : `${driverArgs[0]} ${driverArgs[1]}`;
    if (!DRIVER_COMMANDS_READING_COLLECTIONS.has(command)) return [];
    if (namesCollections(driverArgs)) return [];
    const dir = resolveCollectionsDir(projectRoot);
    if (dir === path.join(projectRoot, DEFAULT_CONFIG_DIR, "collections")) return [];
    return ["--collections", dir];
}
