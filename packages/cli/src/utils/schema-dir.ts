/**
 * Where this project's tables are declared: one answer for every command.
 *
 * `rebase.json`'s `apps.<backend>.tables` names the directory whose `index.ts`
 * exports the tables (default `backend/schema`). Every command that reads the
 * schema — the dev runtime and watcher, `rebase build`, `verify`, `doctor`,
 * `generate-sdk`, `generate view`, `console`, and the driver's `db` / `schema`
 * commands — asks here, so a project that moves the directory moves it for all
 * of them. The previous layout had one resolver too, and still grew five
 * commands that hardcoded `config/collections` beside it; this module is the
 * only place the default is spelled.
 *
 * A directory typed on the command line still wins wherever a command takes
 * one; this is only the default.
 */
import path from "path";
import { DEFAULT_TABLES_DIR, findBackendApp, loadManifest, resolveBackendPaths } from "../manifest";

/**
 * The flag that hands the driver CLI (`@rebasepro/server-postgres`) the schema
 * directory, as an absolute path.
 *
 * The receiving end is the driver's own argument spec: when the driver slice
 * renames its flag, this constant and {@link schemaDirFlag} are the only CLI
 * lines that change.
 */
export const SCHEMA_DIR_FLAG = "--schema-dir";

/** The tables directory, relative to the project root, as the backend app declares it. */
export function resolveTablesDir(projectRoot: string): string {
    try {
        const backend = findBackendApp(loadManifest(projectRoot).manifest);
        if (backend) return resolveBackendPaths(backend.app, projectRoot).tables;
    } catch {
        // A malformed rebase.json is reported by the commands that own it; the
        // conventional layout is the answer until then.
    }
    return DEFAULT_TABLES_DIR;
}

/** The tables directory, absolute. */
export function resolveSchemaDir(projectRoot: string): string {
    return path.join(projectRoot, resolveTablesDir(projectRoot));
}

/**
 * The driver argv naming `dir` as the schema directory: `["--schema-dir", dir]`.
 *
 * The whole CLI → driver contract for this flag, in one function. `dir` is
 * absolute — the driver runs with `cwd: backend/`, so a relative path would be
 * resolved from a directory the user never typed it in.
 */
export function schemaDirFlag(dir: string): string[] {
    return [SCHEMA_DIR_FLAG, dir];
}

/** Whether a command line already names a schema directory. */
function namesSchemaDir(args: readonly string[]): boolean {
    return args.some(arg => arg === SCHEMA_DIR_FLAG || arg.startsWith(`${SCHEMA_DIR_FLAG}=`));
}

/**
 * The driver commands that read the schema directory. Keyed as the driver's
 * argv starts: domain, then subcommand (or the bare command for the
 * single-word ones).
 */
const DRIVER_COMMANDS_READING_SCHEMA = new Set([
    "db push",
    "db generate",
    "schema generate",
    "schema stale",
    "doctor",
    "console"
]);

/**
 * {@link schemaDirFlag} for a driver command line, or nothing.
 *
 * `driverArgs` is the line as the driver gets it (`["db", "push", …]`,
 * `["doctor", …]`). Nothing for a command that does not read the schema,
 * nothing when the line already names a directory, and nothing when the
 * project keeps its tables at the default — the driver's own default is
 * `backend/schema` (`schema` from its `cwd`), so a conventional project's
 * command lines stay as short as they were.
 */
export function schemaDirArgs(projectRoot: string, driverArgs: readonly string[]): string[] {
    const command = DRIVER_COMMANDS_READING_SCHEMA.has(driverArgs[0])
        ? driverArgs[0]
        : `${driverArgs[0]} ${driverArgs[1]}`;
    if (!DRIVER_COMMANDS_READING_SCHEMA.has(command)) return [];
    if (namesSchemaDir(driverArgs)) return [];
    const dir = resolveSchemaDir(projectRoot);
    if (dir === path.join(projectRoot, DEFAULT_TABLES_DIR)) return [];
    return schemaDirFlag(dir);
}
