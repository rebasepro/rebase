/**
 * CLI command: rebase dev
 *
 * Starts the full development environment:
 * - Backend: tsx watch with auto-reload
 * - Frontend: vite dev server
 *
 * Both processes stream output with color-coded prefixes.
 *
 * When the backend uses port-retry (i.e. the configured port is busy and it
 * binds to the next free one), the CLI detects the actual port from stdout
 * and injects VITE_API_URL into the frontend so it connects automatically.
 *
 * Each project gets a deterministic default port derived from the project
 * root path, so multiple Rebase instances never collide.
 */
import chalk from "chalk";
import {
    DEFAULT_RESOURCE_KEY,
    parseEnvBoolean,
    type AppAddress,
    type RebaseProjectManifest,
    type RebaseStaticAppConfig
} from "@rebasepro/types";
import { execa, execaCommandSync, type ResultPromise } from "execa";

import {
    DEV_DATABASE_KIND_ENV,
    managedNotices,
    prepareDatabaseEnv,
    resolveProjectDatabase,
    type PreparedDatabase
} from "../dev-db/prepare";
import { MANAGED_IDLE_TIMEOUT_MS } from "../dev-db/constraints";
import { resolveCliEntry, resolveSpawn } from "../dev-db/daemon";
import { lastDevDatabaseNotice, recordLastDevDatabase } from "../dev-db/last-dev-database";
import path from "path";
import fs from "fs";
import os from "os";
import { createHash } from "crypto";
import { StringDecoder } from "string_decoder";
import { fileURLToPath } from "url";
import {
    cmsMountOf,
    findBackendApp,
    formatAppAddress,
    loadManifest,
    resolveBackendPaths,
    staticAppAddress
} from "../manifest";
import {
    requireProjectRoot,
    findBackendDir,
    findFrontendDir,
    findEnvFile,
    resolveTsx,
    validateTsxInstallation,
    getActiveBackendPlugin,
    resolvePluginCliScript,
    dependenciesNotInstalled
} from "../utils/project";
import { detectPackageManager, getPMCommands } from "../utils/package-manager";
import { parseCommandArgs, switchOn, UsageError, wantsHelp } from "../utils/args";
import { Refusal } from "../utils/refusal";
import { affectsSqlSchema } from "../utils/collection-drift";
import { collectionsDirArgs, resolveCollectionsDir, resolveConfigDir } from "../utils/collections-dir";
import { BootRetry } from "../utils/boot-retry";
import { ensureDevDatabase, probeTcp } from "../utils/dev-preflight";
import { DEV_BACKEND_URL_ENV, getProjectPort } from "../utils/dev-server";
import { runDriverDbCommand, runDriverSchemaCommand } from "./db";
import dotenv from "dotenv";
import { recordEvent } from "../telemetry";

/**
 * The line the watcher prints when it is about to run the entry again.
 *
 * `rebase dev` has no exit code to read: the watcher outlives the process it
 * started, so a backend that dies leaves it running and the CLI printing
 * "Press Ctrl+C to stop all servers." under the stack trace, as if everything
 * were fine.
 *
 * What used to be here was `/Waiting for file changes before restarting/` —
 * **Node's** message, on the theory that `--watch=…` was passed through to
 * Node. It is not: the backend is spawned as `tsx watch …` (see `watchArgs`),
 * so tsx does the watching and Node's line is never printed. The marker
 * matched nothing at all — and the test guarding it ran `node --watch`
 * directly, so it kept proving that Node's wording was intact while the CLI
 * watched a stream that never contained it. That is precisely the silent death
 * the old comment warned about, reached by a different route.
 *
 * So this is tsx's, captured from tsx 4.23.1:
 *
 *     6:26:11 AM [tsx] change in ./src/index.ts Rerunning...
 *     6:26:11 AM [tsx] change in ./src/index.ts Restarting...
 *
 * "Rerunning" when the previous run had already exited, "Restarting" when it
 * was still up and had to be killed first. Both mean the same thing here: the
 * backend that was announced is gone, and whether another one arrives is an
 * open question again — so the readiness deadline is re-armed.
 *
 * Exported so `dev-crash-marker.test.ts` can hold the running tsx to it.
 */
export const WATCHER_RESTART_MARKER = /\[tsx\][^\n]*\b(?:Rerunning|Restarting)\b/i;

/**
 * How often to ask whether the announced backend is still listening.
 *
 * The watcher says nothing when its child is killed outright, so a poll is the
 * only signal there is. Five seconds is chosen against the thing it must not
 * do — report a healthy server as dead — rather than against detection speed:
 * two consecutive misses are needed, so it takes ten seconds of a genuinely
 * closed port to say anything.
 */
const LIVENESS_INTERVAL_MS = 5_000;

/**
 * Strip ANSI codes before matching.
 *
 * At module scope so `portMovedNotice` below can use the same one the stream
 * handlers do: a second copy of this regex is a second thing to keep in step.
 */
// eslint-disable-next-line no-control-regex
const stripAnsi = (str: string) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

/**
 * Calls `onLine` with each line a child process writes to `stream`.
 *
 * A pipe hands over whatever has been written so far, so one line can arrive
 * in two chunks. Split chunk by chunk, "Server running at http://localhost:3001"
 * could read as two fragments that neither matched, and `rebase dev` then
 * never announced the backend or started the admin panel. So the piece after
 * the last newline is held for the next chunk, decoded as UTF-8 across chunk
 * boundaries. A held piece is handed over at the end of the stream, or after
 * `idleFlushMs` with nothing more written, so a prompt or a progress line
 * still shows when it is written.
 *
 * Exported for its test.
 */
export function forEachOutputLine(
    stream: NodeJS.ReadableStream | null | undefined,
    onLine: (line: string) => void,
    idleFlushMs = 100
): void {
    if (!stream) return;
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let idle: NodeJS.Timeout | undefined;

    const emit = (text: string) => {
        for (const line of text.split("\n")) if (line) onLine(line);
    };
    // At the end of the stream the decoder gives up what it holds too; after
    // an idle wait it keeps a character still missing its last bytes.
    const flush = (atEnd: boolean) => {
        clearTimeout(idle);
        idle = undefined;
        const rest = pending + (atEnd ? decoder.end() : "");
        pending = "";
        emit(rest);
    };

    stream.on("data", (data: Buffer | string) => {
        clearTimeout(idle);
        const text = pending + (typeof data === "string" ? data : decoder.write(data));
        const lastNewline = text.lastIndexOf("\n");
        pending = text.slice(lastNewline + 1);
        if (lastNewline >= 0) emit(text.slice(0, lastNewline));
        if (pending) {
            idle = setTimeout(() => flush(false), idleFlushMs);
            idle.unref?.();
        }
    });
    stream.on("end", () => flush(true));
}

/**
 * The corrected banner line, when the backend says it moved port.
 *
 * `↳ PORT = 3014` is printed before the server binds — the backend's
 * environment has to be fixed before it spawns — so when the port turns out to
 * be taken and the server moves, the banner two inches up is simply wrong. The
 * true number then appears in a `[backend]` line a hundred lines of DDL later,
 * which nobody scrolls back through, and the banner is where a reader looks for
 * the port.
 *
 * A correction rather than a rewrite: the terminal is a transcript, and a line
 * that changes after the fact is a line nobody can trust. So the old number is
 * named too.
 *
 * Exported for its test.
 */
export function portMovedNotice(line: string): { from: string; to: string } | null {
    const moved = stripAnsi(line).match(/Port (\d+) is in use — trying (\d+)/);

    return moved ? { from: moved[1], to: moved[2] } : null;
}

/**
 * Quote a path for the shell `execa` runs the backend through.
 *
 * The dev runtime's path is absolute and therefore contains whatever the
 * developer's directories are called. Double quotes do not neutralize `$`,
 * backticks or backslashes in a POSIX shell, so a checkout under a directory
 * named `$(...)` would execute it. Single quotes disable all expansion; on
 * Windows, `cmd.exe` performs no such expansion and wants double quotes.
 */
function quoteForShell(value: string): string {
    if (process.platform === "win32") return `"${value.replace(/"/g, "\\\"")}"`;
    return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Locate the dev runtime shim shipped with the CLI.
 *
 * Published under `runtime/` in the package rather than compiled into `dist/`,
 * because tsx executes it as a file and it must exist on disk at a stable path.
 */
function resolveDevRuntimeEntry(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // Walk up from wherever this module ended up (src/ in development, dist/ in
    // a published install) until the package root with `runtime/` is found.
    let dir = here;
    for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, "runtime", "dev-server.mjs");
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error(
        "Could not find the Rebase dev runtime (runtime/dev-server.mjs). " +
        "Reinstall @rebasepro/cli, or add a backend/src/index.ts to run your own entrypoint."
    );
}

/**
 * Tell the dev runtime where this project keeps its parts.
 *
 * Read from `rebase.json` when there is one, so a project that moved its config
 * directory is honoured; otherwise the conventional layout.
 */
function devRuntimeEnv(projectRoot: string): Record<string, string> {
    const result: Record<string, string> = {
        REBASE_DEV_PROJECT_ROOT: projectRoot,
        REBASE_DEV_CONFIG: "config",
        REBASE_DEV_FUNCTIONS: "backend/functions",
        REBASE_DEV_CRONS: "backend/crons",
        REBASE_DEV_SCHEMA: "backend/src/schema.generated.ts"
    };

    try {
        const loaded = loadManifest(projectRoot);
        const backend = findBackendApp(loaded.manifest);
        if (backend) {
            const paths = resolveBackendPaths(backend.app, projectRoot);
            result.REBASE_DEV_CONFIG = paths.config;
            result.REBASE_DEV_FUNCTIONS = paths.functions;
            result.REBASE_DEV_CRONS = paths.crons;
            result.REBASE_DEV_SCHEMA = paths.schema;
            result.REBASE_DEV_APP = backend.name;
        }
    } catch {
        // An invalid manifest is reported by `rebase build`; dev falls back to
        // the conventional layout rather than refusing to start.
    }

    // Nothing here says whether collections are declared or introspected, and
    // nothing should: `createSourceBundle` drops a config directory that does
    // not exist, and the server derives the answer from that. A REBASE_DEV_MODE
    // env var said it a second time, and a second place to say it is a second
    // place for it to disagree.
    return result;
}

/**
 * Directories `tsx watch` must be told about explicitly, as absolute paths.
 *
 * tsx restarts on a change to anything the entrypoint *imports*. Functions and
 * crons are not imported: the runtime scans their directories at boot. So
 * adding `backend/functions/new.ts` while `rebase dev` ran did nothing —
 * `GET /api/functions/new` stayed 404, and a new cron never registered — until
 * somebody restarted by hand. The same is true of `config/`, which is read as
 * data.
 *
 * `--include` is tsx's own answer to this, it takes a directory rather than a
 * glob, and it tolerates a directory that does not exist yet: a `crons/`
 * created mid-session starts being watched when it appears.
 *
 * @param projectRoot   Absolute path the relative entries are resolved against.
 * @param paths         The `REBASE_DEV_*` map from {@link devRuntimeEnv}.
 */
export function devWatchIncludes(
    projectRoot: string,
    paths: { REBASE_DEV_FUNCTIONS?: string; REBASE_DEV_CRONS?: string }
): string[] {
    const dirs = [paths.REBASE_DEV_FUNCTIONS, paths.REBASE_DEV_CRONS]
        .filter((entry): entry is string => Boolean(entry))
        .map(entry => path.resolve(projectRoot, entry));
    dirs.push(path.join(projectRoot, resolveConfigDir(projectRoot)));
    return dirs;
}

/** Where dev watches the collections it regenerates the schema and SDK from. */
function devCollectionsDir(projectRoot: string): string {
    return resolveCollectionsDir(projectRoot);
}

/**
 * Call `onAppear` once, when `target` exists, and return what stops waiting.
 *
 * Watches the nearest directory above `target` that exists (no higher than
 * `root`), and follows the path down as each part of it appears — `fs.watch`
 * cannot watch a directory that is not there yet. A headless project has no
 * `config/collections` until `rebase schema introspect` writes one, and dev
 * watched it only when it was there at start: the backend kept serving the
 * API it derived from the database, and edits to the new files did nothing,
 * until dev was restarted by hand.
 */
export function whenDirectoryAppears(target: string, root: string, onAppear: () => void): () => void {
    let watcher: fs.FSWatcher | null = null;
    let watching: string | null = null;
    let done = false;
    const stop = (): void => {
        done = true;
        watcher?.close();
        watcher = null;
    };
    const arm = (): void => {
        if (done) return;
        if (fs.existsSync(target)) {
            stop();
            onAppear();
            return;
        }
        let dir = path.dirname(target);
        while (!fs.existsSync(dir) && dir !== root && path.dirname(dir) !== dir) dir = path.dirname(dir);
        if (dir === watching || !fs.existsSync(dir)) return;
        watcher?.close();
        watching = dir;
        try {
            watcher = fs.watch(dir, () => arm());
        } catch {
            // Unwatchable: the collections are picked up at the next start, as before.
            watcher = null;
        }
    };
    arm();
    return stop;
}

/**
 * The file dev writes to restart the backend, or `null` when tsx would not see it.
 *
 * Outside the project, so nothing appears in the developer's tree, and keyed by
 * the project so two `rebase dev`s never restart each other. tsx ignores every
 * path with a dot-named segment (its built-in `**\/.*\/**`), so a trigger under
 * `.rebase/` — or under a TMPDIR inside a dot directory — would never fire; in
 * that case there is no trigger and {@link devWatchArgs} leaves the
 * collections to tsx, as before.
 */
export function devRestartTrigger(projectRoot: string): string | null {
    let tmp = os.tmpdir();
    try {
        tmp = fs.realpathSync(tmp);
    } catch {
        // A tmpdir that cannot be resolved is used as given.
    }
    const key = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
    // Named for what it means: tsx prints the name on every restart it causes.
    const trigger = path.join(tmp, "rebase-dev", key, "collections-changed");
    return trigger.split(path.sep).some(segment => segment.startsWith(".")) ? null : trigger;
}

/**
 * tsx's built-in watch ignores (tsx 4's `watch` command), which it applies
 * relative to its cwd only. {@link devWatchArgs} repeats them under every
 * directory it includes from outside that cwd.
 */
const TSX_DEFAULT_IGNORES = ["**/.*/**", "**/.*", "**/{node_modules,bower_components,vendor}/**"] as const;

/**
 * The `tsx watch` argument list for the backend (unquoted).
 *
 * One save of a collection file must restart the backend once. The runtime
 * `import()`s the collections, so tsx tracks them as dependencies and used to
 * restart the moment a file was saved — before dev had regenerated
 * `schema.generated.ts`. That boot warned "schema.generated.ts no longer
 * describes the database … Run `rebase schema generate`", telling the reader to
 * run what dev was running at that moment, and the regeneration then rewrote
 * the file and restarted the backend a second time. So tsx is told to leave the
 * collections directory alone (`--exclude` wins over its dependency tracking),
 * and dev restarts the backend itself, once, after the regeneration — through
 * `restartTrigger`, which tsx watches.
 *
 * Every included directory also gets tsx's own default ignores, made absolute.
 * tsx resolves those defaults (`**\/node_modules/**`, `**\/.*`, …) against its
 * cwd, which is `backend/`, so they never reached `config/`, a sibling: chokidar
 * walked `config/node_modules` — following symlinks — before tsx spawned the
 * backend at all, and kept every file in it watched. In the monorepo's example
 * app that was 17 s before the first backend line and 1,400 open files, and any
 * install (or another checkout's Vite build writing `.vite-temp` deep inside
 * that tree) restarted the backend. A `.DS_Store` or an editor swap file in
 * `config/` restarted it too.
 */
export function devWatchArgs(
    projectRoot: string,
    paths: { REBASE_DEV_FUNCTIONS?: string; REBASE_DEV_CRONS?: string },
    entryTarget: string,
    restartTrigger: string | null,
    envFile: string | null = null
): string[] {
    // tsx's own flags first: it stops reading flags at the first one it does
    // not know (`--conditions` is Node's) and hands the rest to Node, which
    // then refuses `--include` as a bad option.
    const args = ["watch"];
    // Globs, so forward slashes whatever the platform's separator is.
    const glob = (dir: string) => dir.split(path.sep).join("/");
    for (const dir of devWatchIncludes(projectRoot, paths)) {
        args.push("--include", dir);
        for (const ignored of TSX_DEFAULT_IGNORES) args.push("--exclude", `${glob(dir)}/${ignored}`);
    }
    if (restartTrigger) {
        args.push("--include", restartTrigger);
        args.push("--exclude", `${glob(devCollectionsDir(projectRoot))}/**`);
    }
    // The server reads `.env` at boot, and the entry never imports it, so an
    // edit there changed nothing until some watched file did. tsx watches a
    // named file outside its cwd; one inside `backend/` falls under its own
    // dotfile ignore, and dev watches that one itself (see `envFileHiddenFromTsx`).
    if (envFile) args.push("--include", envFile);
    args.push("--conditions", "development", entryTarget);
    return args;
}

/**
 * Whether tsx, run in `backendDir`, ignores `envFile` whatever it is told.
 *
 * Its default ignores (`**\/.*` among them) are resolved against its cwd, so a
 * `backend/.env` is beyond an `--include`, and a project-root `.env` is not.
 */
export function envFileHiddenFromTsx(envFile: string, backendDir: string): boolean {
    const relative = path.relative(backendDir, envFile);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * The databases the project declares beyond the default, by key.
 *
 * Read from the graph, so `database("analytics")` in `config/resources.ts`
 * is enough for `rebase dev` to serve a second database — the declaration is
 * the request. A config that does not evaluate is the backend's problem to
 * report, in the terms it already uses; here it means "no additional
 * databases", not a refusal to start.
 */
async function declaredAdditionalDatabases(projectRoot: string): Promise<string[]> {
    try {
        const loaded = loadManifest(projectRoot);
        const backend = findBackendApp(loaded.manifest);
        if (!backend) return [];
        const { deriveResourceGraph, deriveOptionsFor } = await import("../resources/derive");
        const { graph } = await deriveResourceGraph({ ...deriveOptionsFor(projectRoot, backend.app), cronsDir: undefined, functionsDir: undefined });
        return graph.resources
            .filter(r => r.kind === "database" && r.transport === "server" && r.key !== DEFAULT_RESOURCE_KEY)
            .map(r => r.key);
    } catch {
        return [];
    }
}

/** Well-known filename the backend writes its actual port to. */
export const DEV_PORT_FILENAME = ".rebase-dev-port";

/**
 * What `.rebase-dev-port` holds: the port the backend bound, then the one it
 * was asked for — the server's own format (`listenWithPortRetry`).
 *
 * The requested half is what tells a later server whether the saved port is
 * meant for it, and `rebase dev` used to overwrite the server's file with the
 * bound port alone. Every server in the project then tried dev's port first:
 * `rebase start` beside dev logged `Port 3755 is in use — trying 3001`, and
 * after a dev that crashed, leaving the file behind, it bound 3755 rather than
 * the `PORT=3001` its environment named.
 */
export function devPortFileContents(bound: number, requested: number): string {
    return `${bound} ${requested}`;
}

/**
 * The `PORT` the scaffold's own `.env.example` ships.
 *
 * `rebase init` copies that file into `.env` verbatim, so every new project has
 * this value whether or not anyone meant it. `init.test.ts` asserts the
 * template still says this number, so the two cannot drift apart in silence.
 */
export const SCAFFOLD_DEFAULT_PORT = 3001;

/**
 * Which rung of the ladder below decided the port.
 *
 * Reported because the ladder is invisible from the outside and the two middle
 * rungs look identical from where the developer stands: `PORT` in the shell
 * wins, `PORT` in `.env` does not — `rebase dev` never reads the file for it —
 * and a saved affinity port looks exactly like a derived one. A developer who
 * sets `PORT=3001` in `.env`, sees 3774, and has nothing to read but the number
 * concludes the setting is broken rather than out of scope.
 */
export type StartPortSource = "--port" | "PORT" | "affinity" | "derived";

/** What the banner says after the port, naming the rung. */
export const START_PORT_SOURCE_LABELS: Record<StartPortSource, string> = {
    "--port": "from --port",
    PORT: "from PORT",
    affinity: "kept from the last run",
    derived: "derived"
};

/**
 * A TCP port, or `undefined` for anything that is not one.
 *
 * One predicate for both sources below. The port file was already checked for
 * range, and `PORT` — the source a human or a platform actually sets — was not,
 * so `PORT=oops` reached `parseInt` and was returned as `NaN`: the dev server
 * then bound to whatever the OS handed out and the CLI printed a URL for a port
 * nothing was listening on.
 */
function parsePort(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const port = Number(raw.trim());
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) return undefined;
    return port;
}

/**
 * The port this project's backend starts on, and the rung that decided it:
 * 1. `--port` (highest priority)
 * 2. `PORT` **in the shell environment** — a `PORT` in `.env` is not read here
 * 3. the port a previous run saved in `.rebase-dev-port` (affinity)
 * 4. a port derived from the project path, unique per project
 */
export function resolveStartPort(
    projectRoot: string,
    explicitPort?: number
): { port: number; source: StartPortSource } {
    // 1. Explicit flag
    if (explicitPort) return { port: explicitPort, source: "--port" };

    // 2. PORT env var. `process.env` only: the CLI does not load `.env` before
    // resolving the port, so a `PORT=` line in that file never reaches here —
    // it is handed to the child, which this then overrides. Both facts are in
    // `getting-started/configuration.md` and in `rebase dev --help`.
    if (process.env.PORT) {
        const fromEnv = parsePort(process.env.PORT);
        if (fromEnv !== undefined) return { port: fromEnv, source: "PORT" };
        // Set deliberately and unusable: falling through silently would start a
        // server on a port nobody asked for and say nothing about why.
        console.warn(chalk.yellow(
            `  ⚠ Ignoring PORT="${process.env.PORT}" — not a port between 1 and 65535.`
        ));
    }

    // 3. Port affinity — check if we wrote a port file from a previous run
    try {
        const portFile = path.join(projectRoot, DEV_PORT_FILENAME);
        if (fs.existsSync(portFile)) {
            // The bound port, first of `<bound> <requested>` — see `devPortFileContents`.
            const saved = parsePort(fs.readFileSync(portFile, "utf-8").trim().split(/\s+/)[0]);
            if (saved !== undefined) return { port: saved, source: "affinity" };
        }
    } catch { /* ignore */ }

    // 4. Deterministic hash
    return { port: getProjectPort(projectRoot), source: "derived" };
}

/**
 * Where a connection string actually points, as `host:port/name`.
 *
 * The banner used to name the database only by *provenance* — "your database
 * (DATABASE_URL in the environment)" — and the boot that follows it writes
 * thirty DDL statements. Which host, which port, which database name appeared
 * nowhere on the success path; only a *failed* connection printed an address.
 * So the one question after pointing a project at staging by accident — did it
 * touch staging? — had no answer in a hundred and twenty lines of output.
 *
 * The password is never in it. `new URL` keeps the credentials in their own
 * fields, so building the string out of `hostname`, `port` and `pathname`
 * cannot carry them by accident, which string surgery on a DSN reliably does.
 *
 * A DSN with no host is a UNIX socket (`postgresql:///app?host=/tmp`), and the
 * socket directory is the address there.
 *
 * Returns null for anything that is not a parseable URL rather than guessing:
 * a banner line that is wrong about the database is worse than one that is
 * missing.
 *
 * Exported for its test.
 */
export function databaseEndpoint(url: string | null | undefined): string | null {
    if (!url) return null;

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    const host = parsed.hostname || parsed.searchParams.get("host");
    if (!host) return null;

    const name = parsed.pathname.replace(/^\//, "");

    return `${host}${parsed.port ? `:${parsed.port}` : ""}${name ? `/${name}` : ""}`;
}

/**
 * What the start banner needs to know about a project's static apps.
 *
 * `rebase dev` runs one frontend: Vite in `frontend/`, at the root of its own
 * localhost port, whatever path or hostname the manifest declares for it. So an
 * app's local address and its deployed one are different things, and for an app
 * with a hostname of its own they share nothing at all — appending its address
 * to the local URL would print `http://localhost:5173https://admin.example.com`.
 */
export interface DevStaticShape {
    declaresStaticApp: boolean;
    /** The declared app whose `root` is the `frontend/` that `rebase dev` runs, if one is. */
    served?: { appName: string; address: AppAddress };
    /** Where the CMS is, when an app declares one. */
    cms?: {
        appName: string;
        /** Always a path. */
        path: string;
        /** The serving app's hostname, when its `path` names one. */
        host?: string;
        /** Whether the app serving it is the one `rebase dev` runs, so it has a local address. */
        servedLocally: boolean;
    };
}

/**
 * Read {@link DevStaticShape} out of a loaded manifest. Exported for its test.
 *
 * Which declared app is running is decided by its `root` being `frontend/`,
 * because that directory is what `startFrontend` launches and nothing else is.
 * When no declared app has that root, which app serves the CMS cannot be told,
 * and it is read as the frontend that does run — what the banner has always
 * assumed, and right for every project `rebase init` scaffolds.
 */
export function devStaticShape(
    manifest: RebaseProjectManifest,
    projectRoot: string,
    frontendDir: string | null
): DevStaticShape {
    const statics: Array<[string, RebaseStaticAppConfig]> = [];
    for (const [name, app] of Object.entries(manifest.apps ?? {})) {
        if (app.type === "static") statics.push([name, app]);
    }

    let served: DevStaticShape["served"];
    if (frontendDir) {
        const running = path.resolve(frontendDir);
        const match = statics.find(([, app]) => path.resolve(projectRoot, app.root) === running);
        if (match) served = { appName: match[0], address: staticAppAddress(match[0], match[1]) };
    }

    const mount = cmsMountOf(manifest);
    return {
        declaresStaticApp: statics.length > 0,
        ...(served ? { served } : {}),
        ...(mount
            ? {
                cms: {
                    appName: mount.appName,
                    path: mount.path,
                    ...(mount.host ? { host: mount.host } : {}),
                    servedLocally: served ? served.appName === mount.appName : true
                }
            }
            : {})
    };
}

/**
 * The banner's lines for a project with a frontend. Exported for its test.
 *
 * Every address is printed whole, once: the local one Vite answers on, and —
 * for an app with a hostname — the https URL it answers on once deployed, on a
 * line of its own beneath it. A CMS in an app `rebase dev` does not run gets its
 * deployed address and a note saying so, rather than a localhost URL that the
 * running frontend's SPA fallback would answer with the wrong app.
 */
export function appBannerLines(frontendUrl: string, api: string, shape: DevStaticShape): Array<[string, string]> {
    const deployedNote = (address: string): [string, string] => ["         ", `${address} when deployed`];
    const lines: Array<[string, string]> = [
        ["", ""],
        ["✦ Rebase is ready!", ""],
        ["➜ Admin: ", frontendUrl]
    ];
    const servedDeployed = shape.served?.address.host ? formatAppAddress(shape.served.address) : undefined;
    if (servedDeployed) lines.push(deployedNote(servedDeployed));
    // Both, because both are needed and only one was printed. The admin URL is
    // where you log in; the API URL is what every SDK client, curl and Swagger
    // link needs — and it is not derivable from the other, since the two ports
    // are derived separately from this project's path.
    lines.push(["➜ API:   ", api]);

    // The CMS, when it is not simply the frontend's home page. Printed rather
    // than assumed: a project that mounts `<RebaseCMS>` at `/admin` inside its
    // product app has an admin URL that appears nowhere — not in the build, not
    // in the running server, not here — and finding it meant reading the
    // frontend's source.
    const cms = shape.cms;
    if (!cms) return lines;
    const cmsDeployed = cms.host ? formatAppAddress({ host: cms.host, path: cms.path }) : undefined;
    if (!cms.servedLocally) {
        lines.push(["➜ CMS:   ", cmsDeployed ?? cms.path]);
        lines.push(["         ", `(app "${cms.appName}" — rebase dev only starts frontend/)`]);
        return lines;
    }
    // The CMS at the root of the running app is the Admin line, deployed
    // address included, and printing it twice only makes the box longer.
    if (cms.path === "/" && cmsDeployed === servedDeployed) return lines;
    lines.push(["➜ CMS:   ", cms.path === "/" ? frontendUrl : `${frontendUrl.replace(/\/$/, "")}${cms.path}`]);
    if (cmsDeployed) lines.push(deployedNote(cmsDeployed));
    return lines;
}

/**
 * The `↳ Database =` line: which database, why it was chosen, and where it is.
 *
 * Provenance alone was what this line said, and the boot underneath it applies
 * schema. "your database (DATABASE_URL in the environment)" and "Applied 30
 * additive schema change(s) before boot" together still do not answer the
 * question somebody asks after pointing a project at staging by accident.
 *
 * The managed database gets its address too — the daemon's port is what a
 * `psql` in another terminal needs, and it is nowhere else in the banner.
 *
 * Exported for its test.
 */
export function databaseBannerValue(prepared: PreparedDatabase | null): string {
    if (!prepared) return "none (--no-db) — the backend needs DATABASE_URL";

    const endpoint = databaseEndpoint(
        prepared.database.kind === "managed" ? prepared.env.DATABASE_URL : prepared.database.url
    );

    return endpoint ? `${prepared.description} · ${endpoint}` : prepared.description;
}

/**
 * Refuse a port the developer named and something else already answers on.
 *
 * `--port` used to be advice, not an instruction: `resolveStartPort` returned
 * the number, the banner printed it, and the server then walked past the
 * collision to 3141, 3142. Because dev ports are derived per project, the
 * number typed into `--port` is very often *another Rebase backend*, so the
 * curl that followed answered 200 from the wrong project rather than refusing
 * — the one failure mode a port collision is supposed to rule out.
 *
 * Asked here as well as in the server (`listenWithPortRetry`'s `explicit`
 * option, which `REBASE_DEV_PORT_EXPLICIT` below turns on) so the refusal
 * arrives before a database is started and a schema is pushed, rather than a
 * minute later underneath them.
 *
 * Both loopback addresses, because a listener on `::1` alone is the same
 * collision and costs one more connect to rule out. Returns the sentence to
 * print, or `null` when there is nothing to refuse.
 *
 * Exported for its test.
 */
export async function pinnedPortRefusal(port: number, pinned: boolean): Promise<string | null> {
    if (!pinned) return null;
    const taken = await Promise.all([probeTcp("127.0.0.1", port), probeTcp("::1", port)]);
    if (!taken.some(Boolean)) return null;
    return `Port ${port} is in use, and you asked for it with --port. ` +
        `Stop whatever is listening on ${port}, or pass a different port. ` +
        "(Without --port, dev derives a port for this project and walks past a collision.)";
}

/**
 * Why `rebase dev` will not start on the database `--database-url` names, or
 * null when something answers there.
 *
 * A TCP connect, not a login: whether the credentials are right is the
 * backend's to say, and it says so in terms of the URL it was given. A URL
 * that does not parse is the backend's to refuse too.
 *
 * Exported for its test.
 */
export async function unreachableDatabaseFlag(
    url: string,
    probe: (host: string, port: number, timeoutMs?: number) => Promise<boolean> = probeTcp
): Promise<string | null> {
    let host: string;
    let port: number;
    try {
        const parsed = new URL(url);
        host = parsed.hostname.replace(/^\[(.*)\]$/, "$1") || "localhost";
        port = parsed.port ? Number(parsed.port) : 5432;
    } catch {
        return null;
    }
    if (await probe(host, port, 3_000)) return null;
    return `Nothing answers at ${host}:${port}, the database --database-url names. ` +
        "Start it, or pass a --database-url that reaches one. Nothing was started.";
}

/**
 * The frontend port for this project, derived the same way the backend's is.
 *
 * `rebase dev` used to leave this entirely to Vite, which takes 5173 and, when
 * that is busy, silently walks to 5174, 5175 and onward. The backend was then
 * started with whatever `FRONTEND_URL` the scaffold's `.env` happened to say —
 * `http://localhost:5173` — so the welcome email linked a port the app was not
 * on. Deriving it here means the value handed to the backend describes the
 * server we are about to start rather than a default nobody checked.
 *
 * Range 5173–5372, so the familiar port is still the common case for a single
 * project and two projects rarely collide.
 *
 * Note this is passed to Vite WITHOUT `--strictPort` unless the developer
 * pinned it explicitly. Vite keeps its fallback, so a busy port still starts —
 * it just starts somewhere the email link does not name, which is exactly
 * today's behaviour and no worse. Pinning REBASE_FRONTEND_PORT makes both
 * exact.
 */
export function getProjectFrontendPort(projectRoot: string): number {
    let hash = 0;
    for (let i = 0; i < projectRoot.length; i++) {
        hash = ((hash << 5) - hash + projectRoot.charCodeAt(i)) | 0;
    }
    return 5173 + (Math.abs(hash) % 200);
}

/**
 * What `rebase dev` says as it stops, about the database it leaves behind.
 *
 * Ctrl+C used to print nothing, and the managed database's daemon stayed up
 * unannounced. Staying up is the design: the database belongs to the project,
 * so the other commands keep reaching it after dev stops. What was missing is
 * saying so, and how to stop it. A database dev did not start is not its to
 * mention.
 */
export function devExitLines(kind: PreparedDatabase["database"]["kind"] | null): string[] {
    if (kind === "managed") {
        const minutes = Math.round(MANAGED_IDLE_TIMEOUT_MS / 60_000);
        return [
            `The development database keeps running for the other commands, and stops itself after ${minutes} minutes with nothing connected.`,
            "Stop it now with `rebase db stop`; the data is kept."
        ];
    }
    if (kind === "docker") {
        return ["The Postgres container keeps running. Stop it with `docker compose stop db`; the data is kept."];
    }
    return [];
}

/**
 * The flags `rebase dev` takes.
 *
 * Exported so `dev.test.ts` can assert that every short alias the help
 * advertises is declared here: the help said `--port, -p` while the spec has
 * only ever declared `-P`, so `rebase dev -p 4000` typed straight off the help
 * page passed `4000` as a positional and started on the default port.
 */
export const DEV_FLAGS = {
    "--backend-only": Boolean,
    "--frontend-only": Boolean,
    "--port": Number,
    /**
     * Point this run at a database of your own, ahead of everything else.
     *
     * The managed development database fills a vacuum; it never redirects a
     * project that has said which Postgres it wants. This flag is the loudest
     * way to say it, and outranks DATABASE_URL in the environment and in .env.
     */
    "--database-url": String,
    /** Use Postgres in Docker rather than the managed database. */
    "--docker": Boolean,
    "-b": "--backend-only",
    "-f": "--frontend-only",
    // `-P` for port, not `-p`. `-p` is `--project` across all ~20 cloud
    // commands — by a wide margin the most-typed short flag in the CLI — and it
    // also means `--password` in `auth`. One letter with three meanings is a
    // flag you have to look up every time, which is the opposite of what a short
    // flag is for. `--project` keeps `-p`; port moves here.
    "-P": "--port",
    // Opts out of the database preflight in `ensureDevDatabase`. Named for what
    // it withholds rather than for the mechanism: a reader reaching for this
    // wants "leave my database alone", not "skip step one of three".
    "--no-db": Boolean
} as const;

/**
 * Read one variable out of the project's env file.
 *
 * `dotenv.parse` rather than `dotenv.config`, because this must not put the
 * project's secrets into the CLI process's own environment — the child
 * processes are given the env file by path and read it themselves.
 */
function readEnvVar(projectRoot: string, name: string): string | undefined {
    const envFile = findEnvFile(projectRoot);
    if (!envFile || !fs.existsSync(envFile)) return undefined;
    try {
        return dotenv.parse(fs.readFileSync(envFile))[name] || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Whether this project declares collections at all.
 *
 * A project with none has no schema to generate or push — the headless BaaS
 * mode serves whatever the database already has.
 */
function projectHasCollections(projectRoot: string): boolean {
    const collectionsDir = devCollectionsDir(projectRoot);
    return fs.existsSync(collectionsDir)
        && fs.readdirSync(collectionsDir).some(name => /\.(ts|js|mts|mjs)$/.test(name) && !name.startsWith("index."));
}

/**
 * Make the generated Drizzle schema match the collections before anything reads it.
 *
 * `rebase init` writes `backend/src/schema.generated.ts` from the preset's own
 * collections (`templates/generated-schemas/<preset>.ts`), so a new project
 * starts with the real schema. It is stale the moment a collection changes, and
 * on the managed PGlite path — the one a new project takes, because `rebase
 * init` leaves `DATABASE_URL` commented out — no `rebase db push` runs to
 * regenerate it. So `dev` does.
 *
 * The driver builds its tables from `information_schema`, so a stale file
 * cannot empty the API. This still runs, because the file is a real artifact
 * for everything around the server: `db push` diffs it, Atlas plans from it,
 * `eject` writes it out, and application code imports it.
 *
 * ## Why it runs unconditionally
 *
 * Generation reads collection files and writes one file. It needs no database,
 * it is idempotent, and it takes about two seconds. Making it a precondition of
 * starting the dev server — rather than a side effect of one database path —
 * is what makes "the generated schema matches the collections" true by
 * construction instead of true by remembering. The same staleness bites a
 * project whose database was already running, where the push never ran either.
 *
 * Failure is not fatal: the server still starts, and it will report the real
 * problem itself. A dev server that refuses to boot because codegen failed is
 * worse than one that boots and says so.
 */
async function ensureGeneratedSchema(projectRoot: string): Promise<SchemaGeneration> {
    if (!projectHasCollections(projectRoot)) return "skipped";
    // Where the driver writes it: `src/schema.generated.ts` under the backend.
    const schemaFile = path.join(findBackendDir(projectRoot) ?? path.join(projectRoot, "backend"), "src", "schema.generated.ts");
    const read = (): string | null => {
        try {
            return fs.readFileSync(schemaFile, "utf8");
        } catch {
            return null;
        }
    };
    const before = read();
    try {
        await runDriverSchemaCommand(["node", "rebase", "schema", "generate"], { quiet: true });
        // Said when it changed, because the file is committed: a stale one means
        // the collections moved without it, and the diff is now the reader's.
        const after = read();
        if (before !== null && after !== null && before !== after) {
            const shown = path.relative(projectRoot, schemaFile).split(path.sep).join("/");
            console.log(`  ${chalk.gray(`↻ ${shown} was out of date with the collections, so it was regenerated.`)}`);
        }
        return "generated";
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`  ${chalk.yellow("⚠")} ${chalk.gray(`Could not regenerate the database schema: ${message}`)}`);
        console.log(`  ${chalk.gray(`Run ${chalk.cyan("rebase schema generate")} to see why. Collection reads will fail until it succeeds.`)}`);
        return "failed";
    }
}

/** What {@link ensureGeneratedSchema} did at startup. */
export type SchemaGeneration = "generated" | "skipped" | "failed";

/**
 * Whether dev must still run the driver's `schema stale --fix` before the
 * backend boots.
 *
 * Not after a regeneration that succeeded: that wrote `schema.generated.ts`
 * from these collections with this driver, moments earlier, and `stale`
 * compares the file against the same generator — it can only answer "nothing
 * stale", and it cost a driver process (~0.6 s) on every start. The repair it
 * exists for, a library upgrade that changed what the generator derives, is
 * exactly what the regeneration already did. When generation was skipped or
 * failed, the preflight is the remaining safety net and still runs.
 */
export function needsStaleSchemaPreflight(generation: SchemaGeneration): boolean {
    return generation !== "generated";
}

/**
 * Make `generated/sdk` match the collections, the same way the schema is kept.
 *
 * This used to happen only under `--generate`, and `generated/` is gitignored,
 * so a fresh clone had no SDK types at all until someone ran
 * `rebase generate-sdk`, and every collection edit left the typed client one
 * step behind. A frontend compiling against a `Database` type that no longer
 * describes the backend is the drift this whole command exists to prevent.
 *
 * A child process rather than a call into `generateSdkCommand`: that loads the
 * collections through jiti, whose module cache would hand the second
 * regeneration the collections the first one loaded. And this CLI re-run
 * directly, not `pnpm exec rebase`: the package manager's pre-run dependency
 * check can start an install on every save, and its `rebase` is whichever one
 * it resolves, not necessarily the one running `dev`.
 *
 * The generator's own output is a usage guide meant for a person who ran it by
 * hand, so it is captured, and on failure only the lines that say what went
 * wrong are shown — not the stack under them. Like the schema, a failure never
 * stops `dev`.
 *
 * `backendPort` is where the backend is, or is about to be: the README's
 * example names it. The first run is before the backend binds, so it is told
 * rather than left to read `.rebase/state.json`.
 */
async function regenerateSdk(projectRoot: string, backendPort: number | null): Promise<void> {
    if (!projectHasCollections(projectRoot)) return;
    const entry = resolveCliEntry();
    const { execPath, prefixArgs } = resolveSpawn(entry);
    try {
        await execa(execPath, [...prefixArgs, entry, "generate-sdk"], {
            cwd: projectRoot,
            all: true,
            // The README's example address — see `DEV_BACKEND_URL_ENV`.
            ...(backendPort !== null ? { env: { [DEV_BACKEND_URL_ENV]: `http://localhost:${backendPort}` } } : {})
        });
    } catch (error) {
        const output = typeof error === "object" && error !== null && "all" in error && typeof error.all === "string"
            ? error.all
            : "";
        const cause = output.split("\n").filter(line => line.trim() && !/^\s+at /.test(line)).slice(-6);
        console.log(`  ${chalk.yellow("⚠")} ${chalk.gray("Could not regenerate the SDK types in generated/sdk.")}`);
        if (cause.length > 0) console.log(chalk.gray(cause.map(line => `    ${line.trim()}`).join("\n")));
        console.log(`  ${chalk.gray(`Run ${chalk.cyan("rebase generate-sdk")} to see why.`)}`);
    }
}

/**
 * One variable's value out of `.env` text, or undefined when it has none.
 *
 * The obvious `\s*(.+?)\s*$` does not do this, because `\s` matches a newline
 * and `$` under /m matches at every line end: on `VITE_API_URL=` followed by
 * `# VITE_GOOGLE_CLIENT_ID=`, the leading `\s*` ate the line break and the
 * capture returned the *next* line. The scaffold ships `VITE_API_URL=` empty,
 * so every first `rebase dev` read a comment as its value, decided it differed
 * from the derived URL, and warned that a variable the developer had not set
 * was being ignored.
 *
 * Horizontal whitespace only, so a value stops at its own line.
 */
export function readEnvValue(envText: string, key: string): string | undefined {
    const match = envText.match(
        new RegExp(`^[^\\S\\r\\n]*${key}[^\\S\\r\\n]*=[^\\S\\r\\n]*(.*?)[^\\S\\r\\n]*$`, "m")
    );
    if (!match) return undefined;

    const value = match[1].replace(/^["']|["']$/g, "");

    return value.length > 0 ? value : undefined;
}

/**
 * The argv the first-boot schema push runs with.
 *
 * The database is named on the command line rather than left to be re-resolved.
 * `runDriverDbCommand` runs the resolver again for whatever argv it is handed,
 * and the argv it used to be handed (`["node","rebase","db","push"]`) carried
 * nothing at all — so on the `--docker` path it read a `.env` whose
 * `DATABASE_URL` is commented out, concluded "managed PGlite", and refused the
 * push for a database that was not the one the preflight had just started.
 *
 * Exported for its test: the missing pair of arguments is the whole defect, and
 * it is invisible in any assertion about the push's *outcome*.
 */
export function schemaPushArgv(databaseUrl: string | undefined): string[] {
    const argv = ["node", "rebase", "db", "push"];
    if (databaseUrl) argv.push("--database-url", databaseUrl);

    return argv;
}

/**
 * Start-up's independent halves, overlapped rather than run one after another.
 *
 * `rebase dev` used to regenerate the schema and the SDK, then derive the
 * resource graph (every collection evaluated again, in this process), then
 * start the managed database and wait for it — about a second when it was not
 * already running — and only then spawn the backend. None of the three reads
 * what another writes: the generators read `config/` and write
 * `backend/src/schema.generated.ts` and `generated/sdk/`; the derivation reads
 * `config/resources.ts` and the collections; the database needs neither, and
 * `schema generate` never connects to one. So `database` starts first and is
 * collected last.
 *
 * `preflight` is the exception, and the reason this is not one `Promise.all`:
 * on the `--docker` path it pushes the schema the generators have just written,
 * so it still runs after them.
 *
 * A database that fails to start is reported where it always was — after the
 * generators' and the preflight's output — rather than ahead of it, and it is
 * never an unhandled rejection while they run.
 *
 * Exported for its test.
 */
export async function overlapDevStartup<T>(steps: {
    generate: () => Promise<SchemaGeneration>;
    preflight: () => Promise<void>;
    /** Resolve and, for the managed database, start it. `null` when this run starts none. */
    database: (() => Promise<T>) | null;
}): Promise<{ schemaGeneration: SchemaGeneration; database: T | null }> {
    const database = steps.database
        ? steps.database().then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error })
        )
        : null;
    const schemaGeneration = await steps.generate();
    await steps.preflight();
    const settled = database ? await database : null;
    if (settled && !settled.ok) throw settled.error;
    return { schemaGeneration, database: settled ? settled.value : null };
}

/**
 * The database half of `rebase dev` starting up.
 *
 * Separated from `ensureDevDatabase` so that everything needing a project on
 * disk lives here and the decision logic stays testable without one.
 */
async function runDatabasePreflight(options: {
    projectRoot: string;
    disabled: boolean;
    /**
     * The DSN the preflight decides from, when the caller resolved one that is
     * not in `.env`. `--docker` is exactly that case: the compose URL is
     * derived, so reading `.env` here saw nothing and the container the flag
     * asked for was never started.
     */
    databaseUrl?: string;
}): Promise<void> {
    const { projectRoot, disabled } = options;

    const hasCollections = projectHasCollections(projectRoot);

    // The one DSN this preflight is about. `ensureDevDatabase` decides from it,
    // and the push has to run against the same one — re-resolving inside the
    // push saw a `.env` with DATABASE_URL commented out, chose the managed
    // PGlite, and refused, on the first `rebase dev --docker` of every scaffold.
    const databaseUrl = options.databaseUrl ?? readEnvVar(projectRoot, "DATABASE_URL");

    const outcome = await ensureDevDatabase({
        projectRoot,
        databaseUrl,
        disabled,
        hasCollections,
        pushSchema: async () => {
            // The same driver entry point `rebase db push` uses, called with the
            // argv layout every command in this CLI receives — the full process
            // argument vector, which the callee slices. `--database-url` names
            // the database the preflight just started, so the push cannot
            // resolve its way to a different one. The throwing variant: a failed
            // push must not take the dev server down with it.
            // Quiet: the database was resolved and announced in the banner above.
            await runDriverDbCommand(schemaPushArgv(databaseUrl), { quiet: true });
        }
    });

    if (outcome.action === "started") console.log("");
}

/**
 * Kill a child `rebase dev` started, with everything it started in turn.
 *
 * Both servers run detached, in a process group of their own, behind a shell
 * and a package manager — so the group is what has to go, not the pid.
 */
function killChildTree(child: ResultPromise): void {
    if (child.killed) return;
    try {
        if (!child.pid) throw new Error("no pid");
        if (process.platform === "win32") {
            execaCommandSync(`taskkill /pid ${child.pid} /T /F`);
        } else {
            process.kill(-child.pid, "SIGKILL");
        }
    } catch {
        try {
            child.kill("SIGKILL");
        } catch {
            // Already gone.
        }
    }
}

/**
 * The port the last `rebase dev` backend landed on, from `.rebase-dev-port`.
 *
 * Read the way the server reads it (`listenWithPortRetry`): the first number,
 * whether the file is the server's `<bound> <requested>` or the CLI's bare
 * `<bound>`. `null` when there is no file or no number in it.
 */
function rememberedDevPort(projectRoot: string): number | null {
    try {
        const raw = fs.readFileSync(path.join(projectRoot, DEV_PORT_FILENAME), "utf-8").trim().split(/\s+/)[0];
        return parsePort(raw) ?? null;
    } catch {
        return null;
    }
}

/**
 * Whether the admin panel can start beside the backend instead of after it.
 *
 * Vite has to be told the backend's URL when it starts (`VITE_API_URL`), and
 * the backend's port is only certain once it has bound — so the admin panel
 * used to wait for "Server running at", and the time to it was the backend's
 * whole boot plus Vite's start. It can start beside the backend whenever the
 * port the backend will bind is known in advance:
 *
 * - **named with `--port`**: the server binds it or refuses to start, never
 *   walks past it (`REBASE_DEV_PORT_EXPLICIT`), and `pinnedPortRefusal` has
 *   already checked that nothing answers there;
 * - **free, and the port the backend tries first**: the server tries the port
 *   its last run landed on before the one it is given (`.rebase-dev-port`), so
 *   a remembered port must be this one — the "kept from the last run" rung —
 *   or absent, which it is after every clean exit, and the derived port is
 *   then the one tried. A port something already answers on would make the
 *   backend move, so that case keeps the old order.
 *
 * Nothing here can rule out another process taking the port in the second the
 * backend boots, so `devCommand` still compares the announced port with the
 * one Vite was given and restarts the admin panel when they differ.
 *
 * Exported for its test.
 */
export async function frontendCanStartWithBackend(options: {
    projectRoot: string;
    port: number;
    pinned: boolean;
    probe?: (host: string, port: number) => Promise<boolean>;
}): Promise<boolean> {
    if (options.pinned) return true;
    const remembered = rememberedDevPort(options.projectRoot);
    if (remembered !== null && remembered !== options.port) return false;
    const probe = options.probe ?? probeTcp;
    const taken = await Promise.all([probe("127.0.0.1", options.port), probe("::1", options.port)]);
    return !taken.some(Boolean);
}

/**
 * The tsx the backend is watched with, or exit saying why there is none.
 *
 * Checked before anything is started rather than just before the backend
 * spawns: start-up begins the database at once now, and a project whose
 * dependencies are missing should hear that first, not after two generators
 * have each failed on the same cause.
 */
function requireUsableTsx(projectRoot: string): string {
    const tsxBin = resolveTsx(projectRoot);
    if (!tsxBin) {
        console.error(chalk.red(`  ✗ ${dependenciesNotInstalled(projectRoot)}`));
        process.exit(1);
    }

    // Verify the tsx installation is intact (not just the symlink)
    const tsxValidationError = validateTsxInstallation(tsxBin);
    if (tsxValidationError) {
        const pmCmdsLocal = getPMCommands(detectPackageManager(projectRoot));
        const installCmd = pmCmdsLocal.install.join(" ");
        console.error(chalk.red("  ✗ tsx installation appears corrupted."));
        console.error(chalk.gray(`    ${tsxValidationError}`));
        console.error("");
        console.error(chalk.gray("    To fix, run:"));
        console.error(chalk.cyan(`      rm -rf node_modules && ${installCmd}`));
        process.exit(1);
    }
    return tsxBin;
}

export async function devCommand(rawArgs: string[]): Promise<void> {
    if (wantsHelp(rawArgs)) {
        printDevHelp();
        return;
    }

    // Removed rather than kept as a no-op: what it switched on is how `dev`
    // always behaves now. Named, so the answer is "drop it" rather than a
    // generic unknown-option error that reads like a typo.
    if (switchOn(rawArgs, "--generate") || rawArgs.includes("-g")) {
        throw new UsageError(
            "`rebase dev --generate` is gone: dev now regenerates the schema and the SDK types " +
            "on every start and every collection save. Drop the flag."
        );
    }

    const { flags: args } = parseCommandArgs({
        spec: DEV_FLAGS,
        rawArgs,
        commandWords: 1,
        command: "dev",
        maxPositionals: 0
    });

    const projectRoot = requireProjectRoot();

    // Fire-and-forget, and a no-op unless the developer opted in. Deliberately
    // not awaited: `rebase dev` starting is the thing the user is waiting for,
    // and a slow collector must never be in front of it.
    void recordEvent("cli.dev", {
        backend_only: Boolean(args["--backend-only"]),
        frontend_only: Boolean(args["--frontend-only"])
    }, { projectRoot });
    const backendDir = findBackendDir(projectRoot);
    const frontendDir = findFrontendDir(projectRoot);
    const backendOnly = args["--backend-only"] || false;
    const frontendOnly = args["--frontend-only"] || false;
    /**
     * Start no database at all — not the compose container, and not the managed
     * one either. Read once, here, because both halves of `dev` have to agree:
     * gating only the preflight left the managed PGlite starting anyway, which
     * is the one database a scaffolded project would otherwise get.
     */
    const noDb = Boolean(args["--no-db"]) || parseEnvBoolean(process.env.REBASE_DEV_NO_DB) === true;

    // Resolve the ports ONCE, before starting anything. Both, because the
    // backend is told where the frontend will be and cannot be told later: its
    // environment is fixed when it spawns.
    const { port: startPort, source: startPortSource } = resolveStartPort(projectRoot, args["--port"]);
    // Named, not derived — see `pinnedPortRefusal`. Only the flag counts: the
    // .env's `PORT` is deliberately overridden by this command, and the shell's
    // is what a test harness sets when it wants a port that may still move.
    // `startPortSource === "--port"` says the same thing; kept as its own read
    // because this one is about the *flag*, not about which rung answered.
    const portIsPinned = args["--port"] !== undefined;
    const pinnedFrontendPort = process.env.REBASE_FRONTEND_PORT;
    if (pinnedFrontendPort && !/^\d+$/.test(pinnedFrontendPort)) {
        throw new Refusal(`REBASE_FRONTEND_PORT must be a number, got ${JSON.stringify(pinnedFrontendPort)}.`);
    }
    const frontendPort = pinnedFrontendPort
        ? Number(pinnedFrontendPort)
        : getProjectFrontendPort(projectRoot);

    // Before the banner, and before anything is started: a pinned port that is
    // already answering is a refusal, not a warning, and the developer should
    // get it in the first second rather than after a database and a schema push.
    if (!frontendOnly) {
        const refusal = await pinnedPortRefusal(startPort, portIsPinned);
        if (refusal) {
            console.error(chalk.red(`  ✗ ${refusal}`));
            process.exit(1);
        }
    }

    const flagUrl = typeof args["--database-url"] === "string" ? args["--database-url"] : null;
    // A database named on this command line that nothing answers at is the
    // same kind of refusal, said in the flag's terms. The backend's own banner
    // said "Verify DATABASE_URL in your .env file", and dev ran on with the
    // backend dead.
    if (!frontendOnly && !noDb && flagUrl) {
        const refusal = await unreachableDatabaseFlag(flagUrl);
        if (refusal) {
            console.error(chalk.red(`  ✗ ${refusal}`));
            process.exit(1);
        }
    }

    const startsBackend = !frontendOnly && Boolean(backendDir);

    // Before anything is started, because the database now starts at once: a
    // project that cannot run its backend should not be left with a database
    // daemon it never got to use, nor wait for two generators first.
    const tsxBin = startsBackend ? requireUsableTsx(projectRoot) : null;

    console.log("");
    console.log(chalk.bold("  🚀 Rebase Dev Server"));
    console.log("");

    // Start the development database and give it a schema, when this project
    // has one that is plainly local and plainly not running. Everything about
    // when it declines is in `ensureDevDatabase`; the frontend-only case is
    // decided here because there is no backend to need a database at all.
    let schemaGeneration: SchemaGeneration = "skipped";
    /**
     * The database this run's backend gets. A project with a DATABASE_URL is
     * untouched; a project without one gets a managed Postgres, which is what
     * makes `rebase dev` the only command a new project needs.
     *
     * `--no-db` means start nothing, and that includes the managed database.
     * It used to gate only the preflight, so the one path that actually starts
     * a database on a scaffolded project — the managed PGlite — ran anyway:
     * `rebase dev --no-db` wrote `.rebase/pglite/`, booted a daemon and served
     * against it, which is the opposite of what a reader asking for no database
     * expects. The backend is left to fail on the DATABASE_URL it cannot find,
     * which is the failure the flag exists to produce.
     */
    let prepared: PreparedDatabase | null = null;
    /**
     * The backend port the SDK README was last generated for: the one the
     * backend is told at boot, then each one it announces it bound.
     */
    let sdkBackendPort: number | null = startsBackend ? startPort : null;
    const regenerateSdkFor = (port: number | null): Promise<void> => {
        sdkBackendPort = port;
        return regenerateSdk(projectRoot, port);
    };
    if (!frontendOnly) {
        // `--docker` names a container, not a connection string, and the
        // preflight is what starts it — but only when the order picks Docker. A
        // DATABASE_URL outranks the flag, and the preflight used to start the
        // container and push the schema into it while the backend ran elsewhere.
        // Pure, so deciding costs nothing; `prepareDatabaseEnv` reaches the same
        // answer and says the flag was ignored.
        const resolved = args["--docker"]
            ? resolveProjectDatabase(projectRoot, { flagUrl, flagDocker: true, followLastDev: false })
            : null;
        const dockerUrl = resolved?.kind === "docker" ? resolved.url ?? undefined : undefined;
        ({ schemaGeneration, database: prepared } = await overlapDevStartup({
            // Side by side: they read the same collections and write different
            // files, so the SDK costs nothing on top of the schema.
            generate: async () => (await Promise.all([ensureGeneratedSchema(projectRoot), regenerateSdkFor(sdkBackendPort)]))[0],
            // Not under --database-url: the preflight decides from `.env`, and
            // may start the compose container it names, which is not the
            // database the flag points this run at.
            preflight: () => runDatabasePreflight({
                projectRoot,
                disabled: noDb || flagUrl !== null,
                databaseUrl: dockerUrl
            }),
            database: startsBackend && !noDb
                ? async () => prepareDatabaseEnv(projectRoot, {
                    flagUrl,
                    flagDocker: Boolean(args["--docker"]),
                    // This run's flags are the choice; the record below is
                    // what the other commands follow.
                    followLastDev: false,
                    onProgress: (message) => console.log(chalk.gray(`  ${message}`)),
                    additionalKeys: await declaredAdditionalDatabases(projectRoot)
                })
                : null
        }));
    }

    // What the other commands follow — `rebase db url`, `db push`, `console` —
    // so they reach the database this server is on rather than resolve their
    // own. See `last-dev-database.ts`.
    if (prepared) {
        const run = { dockerFlag: Boolean(args["--docker"]) };
        const { previous } = recordLastDevDatabase(projectRoot, prepared.database.kind, run);
        const notice = lastDevDatabaseNotice(previous, prepared.database.kind, run);
        if (notice) console.log(`  ${chalk.yellow("⚠")} ${chalk.gray(notice)}`);
    }

    const children: ResultPromise[] = [];

    /**
     * Whether this project has an admin panel to serve at all.
     *
     * A headless project declares one app, of type "backend", so there is no
     * `frontend/` and never will be. Warning that a directory is "missing" for
     * a shape that has no such directory reads as a broken scaffold on the
     * very first run of the very command the headless quickstart names.
     */
    const staticShape = ((): DevStaticShape => {
        try {
            // Where the banner's "Admin" link actually reaches the CMS, and
            // where each is once deployed. For the scaffolded project the CMS
            // is the frontend's root and the two are the same URL; for a
            // project that mounts the CMS as one route of a larger app, or in
            // an app of its own, they are not.
            return devStaticShape(loadManifest(projectRoot).manifest, projectRoot, frontendDir);
        } catch {
            // A manifest that will not load is a different problem, reported
            // elsewhere. Fall back to the directory, which is what this check
            // used to be.
            return { declaresStaticApp: Boolean(frontendDir) };
        }
    })();
    const declaresStaticApp = staticShape.declaresStaticApp;

    // --- State for printing the banner ---
    let frontendUrl = "";
    let backendUrl = "";
    let debounceSummary: NodeJS.Timeout | null = null;
    let bannerPrinted = false;

    /** Actual backend port, resolved once the server prints its URL. */
    let resolvedBackendPort: number | null = null;

    /**
     * The connection string of the database this run started, when it started
     * one. Filled in below; read by the headless banner, which is the only
     * place a headless project could learn it — there is no admin panel to
     * open, and `.env` deliberately does not name the managed database.
     */
    let managedConnectionString: string | null = null;

    /**
     * Where the backend mounted Swagger, if it mounted it at all.
     *
     * Read from the backend's own log rather than assumed: a headless project
     * with no tables yet serves no data API and no Swagger, and the banner must
     * not name a URL that answers 404.
     */
    let swaggerPath: string | null = null;

    function printSummary() {
        if (!backendUrl) return;
        // A headless project has no frontend URL to wait for, and waiting for
        // one meant it got no banner at all: the first run of `rebase dev`
        // ended in log lines, with the API URL, the Swagger path and the
        // database it had just created all unstated.
        if (declaresStaticApp && !frontendUrl) return;
        if (debounceSummary) clearTimeout(debounceSummary);
        debounceSummary = setTimeout(() => {
            if (bannerPrinted) return;

            const api = `http://localhost:${resolvedBackendPort}`;
            /** `[label, value]` per line; an empty pair is a blank line. */
            const lines: Array<[string, string]> = declaresStaticApp
                ? appBannerLines(stripAnsi(frontendUrl), api, staticShape)
                : [["", ""], ["✦ Rebase API is ready!", ""], ["➜ API:      ", api]];

            if (!declaresStaticApp) {
                // Only when it is actually mounted. A project with no tables
                // yet mounts no data API and no Swagger, and printing a URL
                // that 404s is worse than printing nothing — the reader spends
                // the next ten minutes deciding whether their install is
                // broken. The backend says which; this reads its own child.
                if (swaggerPath) {
                    lines.push(["➜ Swagger:  ", `${api}${swaggerPath}`]);
                } else {
                    // Say why, in the box the reader is actually looking at.
                    // "No docs" with no reason reads as a broken install.
                    lines.push(["  ", "(no tables served yet, so no data API and no docs)"]);
                }
                if (managedConnectionString) {
                    lines.push(["", ""]);
                    lines.push(["Database (managed, this project only):", ""]);
                    lines.push(["  ", managedConnectionString]);
                    lines.push(["  ", "also: rebase db url"]);
                }
            }

            // Both halves of the first-admin rule, in the box the reader is
            // looking at when they go to sign in.
            //
            // `rebase init` writes REBASE_ADMIN_EMAIL and a generated password
            // into `.env` — for the compose stack, which runs in production,
            // where the first-registration window is shut. Nothing said so, and
            // `rebase dev` reads the same file, so the honest reading of that
            // `.env` was "these are my credentials" and the documented first
            // step — register, become the admin — looked broken.
            lines.push(["", ""]);
            lines.push(["First login: ", "the first account to register becomes admin"]);
            lines.push(["  ", "(a production boot seeds REBASE_ADMIN_EMAIL from .env instead)"]);
            lines.push(["", ""]);

            // Sized to its contents. A fixed width silently pushed the right
            // border off the moment a value was longer than the cell, and a
            // managed connection string — port and all — always is.
            const inner = Math.max(...lines.map(([label, value]) => label.length + value.length)) + 4;

            console.log("");
            console.log(chalk.cyan("┌" + "─".repeat(inner) + "┐"));
            for (const [label, value] of lines) {
                console.log(
                    chalk.cyan("│  ") + label + chalk.white(value) +
                    " ".repeat(inner - 2 - label.length - value.length) +
                    chalk.cyan("│")
                );
            }
            console.log(chalk.cyan("└" + "─".repeat(inner) + "┘"));
            console.log("");
            bannerPrinted = true;
        }, 500);
    }

    /**
     * Set once Ctrl+C has been seen, so a child dying on the way out is not
     * reported as a crash. Everything below distinguishes "the backend fell
     * over" from "you asked me to stop" by this flag alone — an exit code of
     * `null` with a signal is the shape of both.
     */
    let shuttingDown = false;

    // Handle graceful shutdown
    const cleanup = () => {
        shuttingDown = true;
        // Clean up dev port file
        try {
            const portFile = path.join(projectRoot, DEV_PORT_FILENAME);
            if (fs.existsSync(portFile)) fs.unlinkSync(portFile);

            const urlFile = path.join(projectRoot, ".rebase-dev-url");
            if (fs.existsSync(urlFile)) fs.unlinkSync(urlFile);
        } catch { /* ignore */ }

        children.forEach(killChildTree);
        const exitLines = devExitLines(prepared?.database.kind ?? null);
        if (exitLines.length > 0) {
            console.log("");
            for (const line of exitLines) console.log(chalk.gray(`  ${line}`));
        }
        // Not a hard-coded 0. Ctrl+C is how `rebase dev` normally ends, so
        // exiting 0 unconditionally threw away the one thing `--backend-only`
        // has to report: whether the backend it was asked to run is up. A
        // healthy run still exits 0 — nothing sets the code in that case.
        process.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    /** The running admin panel, and the backend port it was told (`VITE_API_URL`). */
    let frontendChild: ResultPromise | null = null;
    let frontendApiPort: number | null = null;

    /**
     * Start the Vite frontend, optionally injecting the backend port.
     */
    function startFrontend(backendPort: number | null) {
        if (!frontendDir) return;

        console.log(`  ${chalk.magenta("▶")} Frontend: ${chalk.gray(frontendDir)}`);

        const frontendEnv: Record<string, string> = { ...process.env as Record<string, string> };

        frontendApiPort = backendPort;
        // Inject the resolved backend URL so Vite picks it up
        if (backendPort) {
            frontendEnv.VITE_API_URL = `http://localhost:${backendPort}`;
            console.log(`  ${chalk.gray("↳ VITE_API_URL")} = ${chalk.white(`http://localhost:${backendPort}`)}`);
        }

        const pm = detectPackageManager(projectRoot);
        const pmCmds = getPMCommands(pm);
        const runDevCmd = pmCmds.run("dev");

        /**
         * Pin the frontend's port when asked.
         *
         * Vite takes 5173 and hands it to the first asker, so a machine already
         * running one dev server gives the second either a bind failure or —
         * worse — somebody else's app on the address you expected. The backend
         * port has been pinnable since it had the same problem; this is the
         * other half.
         *
         * npm needs `--` before script arguments and pnpm does not, which is
         * the kind of difference that silently passes `--port` to the package
         * manager instead of to Vite.
         */
        if (pm === "npm") runDevCmd.push("--");
        runDevCmd.push("--port", String(frontendPort));
        // `--strictPort` only when the developer pinned the port: they asked for
        // that exact one and a silent move defeats the point. Unpinned, Vite
        // keeps its own fallback, so a busy port still starts the frontend.
        if (pinnedFrontendPort) runDevCmd.push("--strictPort");
        console.log(`  ${chalk.gray("↳ frontend port")} = ${chalk.white(String(frontendPort))}`);

        const child = execa(
            runDevCmd[0],
            runDevCmd.slice(1),
            {
                cwd: frontendDir,
                stdio: ["inherit", "pipe", "pipe"],
                env: frontendEnv,
                shell: true,
                detached: process.platform !== "win32"
            }
        );
        child.catch(() => {}); // prevent unhandled promise rejection on exit
        frontendChild = child;

        forEachOutputLine(child.stdout, (line) => {
            console.log(`${chalk.magenta.bold("[admin]")} ${line}`);
            const cleanLine = stripAnsi(line);
            const urlMatch = cleanLine.match(/(http:\/\/(?:localhost|127\.0\.0\.1):\d+)/);
            // Only the current one: a replaced admin panel's last words are not its address.
            if (cleanLine.includes("Local:") && urlMatch && child === frontendChild) {
                frontendUrl = urlMatch[1];
                printSummary();
            }
        });

        forEachOutputLine(child.stderr, (line) => {
            console.log(`${chalk.magenta.bold("[admin]")} ${line}`);
        });

        children.push(child);
    }

    /**
     * Start the admin panel again, told the port the backend actually bound.
     *
     * Only reachable when it was started beside the backend
     * ({@link frontendCanStartWithBackend}) and something took that port in the
     * second the backend booted, so the backend moved. Left alone, the admin
     * panel would talk to whatever now answers on the old port — very often
     * another Rebase backend, since dev ports are derived per project.
     */
    async function restartFrontend(backendPort: number): Promise<void> {
        const stale = frontendChild;
        frontendUrl = "";
        console.log(`  ${chalk.gray(`↳ The backend moved from ${frontendApiPort} to ${backendPort}; restarting the admin panel on it.`)}`);
        if (stale) {
            frontendChild = null;
            const index = children.indexOf(stale);
            if (index >= 0) children.splice(index, 1);
            killChildTree(stale);
            // Settled either way — it was killed, so it rejects — and never
            // through `finally`, whose promise would carry that rejection on
            // with nothing to catch it.
            await stale.then(() => undefined, () => undefined);
            // Its port is free once the process is gone, which can trail the
            // shell above it. Vite would otherwise take the next port — or,
            // pinned with --strictPort, refuse to start.
            for (let attempt = 0; attempt < 30 && await probeTcp("127.0.0.1", frontendPort, 200); attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        if (!shuttingDown) startFrontend(backendPort);
    }

    // Start backend
    if (startsBackend && backendDir && tsxBin) {
        const envFile = findEnvFile(projectRoot);
        const env: Record<string, string> = { ...process.env as Record<string, string> };
        if (envFile) {
            env.DOTENV_CONFIG_PATH = envFile;
        }

        // The database was resolved — and the managed one started — beside the
        // generators above; see `overlapDevStartup`.
        if (prepared) Object.assign(env, prepared.env);
        /**
         * Whether this run is on the managed database.
         *
         * `db push` runs on either one — on the managed database, which serves
         * exactly one database, it plans against a throwaway in-memory PGlite
         * instead of a second database beside it — but its children and the
         * backend still word their remedies for the database under this run.
         */
        const managed = prepared?.database.kind === "managed";
        if (managed) managedConnectionString = prepared?.env.DATABASE_URL ?? null;
        // …and the backend needs the same answer, for the same reason: its
        // schema-drift remedy is worded for the database it serves. `db`,
        // `schema` and `doctor` already pass this to their driver children;
        // the backend is the one that had to guess.
        if (prepared) env[DEV_DATABASE_KIND_ENV] = prepared.database.kind;

        // Always inject PORT so the backend uses our resolved port instead of
        // its hardcoded default (3001). This prevents cross-project collisions
        // when multiple Rebase instances run simultaneously.
        env.PORT = String(startPort);
        // …and whether that number was typed or derived, which decides whether
        // the server may walk past a collision. Always stated, never merely
        // set: `env` starts as a copy of this process's, so leaving the key
        // alone would let an inherited value pin a port nobody asked for.
        // The server also reads its presence as "rebase dev started me", and
        // takes over `.rebase/state.json` from a `rebase start` beside it.
        env.REBASE_DEV_PORT_EXPLICIT = String(portIsPinned);

        // And where the frontend will be, for the same reason. `FRONTEND_URL`
        // is the base of every emailed link and one of the two things CORS is
        // derived from, and the scaffold's `.env` states a fixed
        // `http://localhost:5173` that this command overrides — so the welcome
        // email linked a port the app was not running on. The frontend-only
        // case never reaches here, and there the .env value is still right.
        if (!backendOnly && frontendDir) {
            env.FRONTEND_URL = `http://localhost:${frontendPort}`;
        }

        console.log(`  ${chalk.cyan("▶")} Backend:  ${chalk.gray(backendDir)}`);
        console.log(`  ${chalk.gray("↳ PORT")} = ${chalk.white(String(startPort))} ${chalk.gray(`(${START_PORT_SOURCE_LABELS[startPortSource]})`)}`);
        console.log(`  ${chalk.gray("↳ Database")} = ${chalk.white(databaseBannerValue(prepared))}`);
        // Stated on every start rather than left to be discovered. A developer
        // who does not know requests are serialized here will read the
        // difference as a bug in their own code.
        if (prepared) {
            for (const line of managedNotices(prepared).slice(1)) console.log(`  ${chalk.gray(line)}`);
        }

        // The .env's PORT / VITE_API_URL look authoritative but are overridden in
        // dev: we derive a per-project port to avoid cross-project collisions and
        // point the frontend at it. Surface that so a mismatched .env doesn't turn
        // into a silent "connecting to the wrong port" debugging loop.
        if (envFile) {
            try {
                const envText = fs.readFileSync(envFile, "utf-8");
                const envPort = readEnvValue(envText, "PORT");
                const envApiUrl = readEnvValue(envText, "VITE_API_URL");
                // Only name the keys — never echo a raw `http://localhost:<port>`
                // value, so log scrapers don't mistake it for the dev server URL.
                const overridden: string[] = [];
                // A value equal to the scaffold's own default was written by
                // the scaffold, not chosen by anyone, so there is nothing to
                // warn about: this fired on the very first `rebase dev` of
                // every new project, about a line the developer had not read
                // yet, for a setting that applies to a command they had not
                // run. A warning that is always there is a warning nobody
                // reads when it matters.
                const portWasChosen = Boolean(envPort) && envPort !== String(SCAFFOLD_DEFAULT_PORT);
                if (portWasChosen && envPort !== String(startPort)) overridden.push("PORT");
                if (envApiUrl && envApiUrl !== `http://localhost:${startPort}`) overridden.push("VITE_API_URL");
                if (overridden.length > 0) {
                    console.log(chalk.yellow(
                        `  ⚠ dev uses a derived per-project port (${startPort}); your .env ${overridden.join(" / ")} ` +
                        `${overridden.length > 1 ? "are" : "is"} ignored here (avoids cross-project collisions). ` +
                        `Pass ${chalk.white("--port")} to pin a port.`
                    ));
                }
            } catch { /* ignore — best-effort notice */ }
        }

        /** Whether the frontend has been launched (we only launch it once). */
        let frontendLaunched = false;
        /**
         * Whether the backend's first "Server running at" has been compared
         * with the port an admin panel started beside it was given. Once:
         * where a later restart lands is the watcher's business, as before.
         */
        let frontendPortChecked = false;

        // A generated schema that a *library upgrade* invalidated, repaired before
        // the backend sees it.
        //
        // Distinct from the regeneration further down, which watches
        // `config/collections` and so only fires when the developer edits
        // something. This case has no edit: 0.13 derives `category_id` where 0.12
        // derived `categorie_id`, from an unchanged collection. Boot-ensure renames
        // the database column, relation validation reads the stale generated module
        // and refuses to start — on this boot and every boot after, since the
        // rename does not run twice. Regenerating is the whole fix, and the release
        // note promises the rename is handled, so do it rather than announce it.
        //
        // Not the same thing as the regeneration at startup: this is not "keep
        // my schema fresh", it is "do not hand the runtime a file that cannot
        // boot".
        try {
            const activePlugin = getActiveBackendPlugin(backendDir);
            const pluginCli = activePlugin ? resolvePluginCliScript(backendDir, activePlugin) : null;
            if (pluginCli && needsStaleSchemaPreflight(schemaGeneration)) {
                const staleArgs = ["schema", "stale", "--fix"];
                await execa(tsxBin, [pluginCli, ...staleArgs, ...collectionsDirArgs(projectRoot, staleArgs)], {
                    cwd: backendDir,
                    stdio: "inherit",
                    env
                });
            }
        } catch {
            // Never block `dev` on this. A project with no generated schema, a
            // driver too old to know the subcommand, or a collections directory
            // that will not load all land here, and the boot itself reports each
            // of them better than a preflight can.
        }

        // A project with its own `backend/src/index.ts` runs it, exactly as
        // before. Without one, dev boots the stock runtime over the project's
        // TypeScript source — the same boot path a deployment takes, so what runs
        // locally is what will run deployed. This is what makes the hand-written
        // entrypoint optional instead of something every project must carry.
        const ejectedEntry = path.join(backendDir, "src", "index.ts");
        const usesStockRuntime = !fs.existsSync(ejectedEntry);
        const entryTarget = usesStockRuntime ? resolveDevRuntimeEntry() : "src/index.ts";

        // Computed even for an ejected backend: the paths are where the *project*
        // keeps its functions and crons, which is what dev has to watch, and an
        // ejected entrypoint reads the same directories.
        const runtimePaths = devRuntimeEnv(projectRoot);
        if (usesStockRuntime) {
            Object.assign(env, runtimePaths);
        }

        const restartTrigger = devRestartTrigger(projectRoot);
        if (restartTrigger) {
            try {
                fs.mkdirSync(path.dirname(restartTrigger), { recursive: true });
                fs.writeFileSync(restartTrigger, String(Date.now()));
            } catch {
                // Unwritable tmpdir: the trigger cannot fire, so let tsx keep the
                // collections — two restarts per save beats none.
            }
        }
        const usableTrigger = restartTrigger && fs.existsSync(restartTrigger) ? restartTrigger : null;
        const envFileForDev = envFile && envFileHiddenFromTsx(envFile, backendDir) ? envFile : null;
        const watchArgs = devWatchArgs(projectRoot, runtimePaths, entryTarget, usableTrigger, envFileForDev ? null : envFile).map(quoteForShell);
        /** Restart the backend once, after dev has finished reacting to a collection save. */
        const restartBackend = (): void => {
            if (!usableTrigger) return; // tsx restarted on the save itself
            try {
                fs.writeFileSync(usableTrigger, String(Date.now()));
            } catch {
                // Best effort: the next save tries again.
            }
        };
        // A `backend/.env` is under tsx's own dotfile ignore, so dev watches it
        // and restarts the backend through the trigger. The directory, not the
        // file: an editor that saves by renaming replaces the file a watch on it
        // would have followed.
        if (envFileForDev && usableTrigger) {
            let envDebounce: NodeJS.Timeout | null = null;
            fs.watch(path.dirname(envFileForDev), (_event, filename) => {
                if (filename !== path.basename(envFileForDev)) return;
                if (envDebounce) clearTimeout(envDebounce);
                envDebounce = setTimeout(() => {
                    console.log(chalk.gray(`  ↻ ${path.relative(projectRoot, envFileForDev)} changed: restarting the backend.`));
                    restartBackend();
                }, 200);
            });
        }
        const generatedSchemaFile = path.resolve(projectRoot, runtimePaths.REBASE_DEV_SCHEMA);
        /** What tsx reacts to: a write, even of identical bytes, moves the mtime. */
        const generatedSchemaStamp = (): string | null => {
            try {
                const stat = fs.statSync(generatedSchemaFile);
                return `${stat.mtimeMs}:${stat.size}`;
            } catch {
                return null;
            }
        };

        // Watch the collections folder and regenerate what is derived from it.
        //
        // This used to print a box telling the reader to run `rebase schema
        // generate` themselves, which made the documented first edit fail in a
        // way nothing named. tsx restarts the backend on a config change, boot's
        // additive ensure adds the new column to the database — and then the
        // very first save of a row carrying it answered 400
        // VALIDATION_UNKNOWN_FIELDS, because the driver looked its columns up in
        // `backend/src/schema.generated.ts` and that file was still the one
        // generated before the edit.
        //
        // The driver reads the database now, so that particular 400 is gone at
        // the root. This stays because the file is still what `eject` and the
        // developer's own imports read, and the SDK types are what a frontend
        // compiles against: either one silently falling behind the collections
        // during a dev session is a surprise waiting at the next deploy. The
        // reader's single instruction is still "save the file".
        const collectionsDir = devCollectionsDir(projectRoot);
        {
            let debounce: NodeJS.Timeout | null = null;
            // The SQL schema and the SDK do not answer to the same edits. The
            // SDK is generated from the collections `index` module, which can
            // re-export anything the project puts under this directory, so every
            // change is a reason to rebuild it. The Drizzle schema covers only the
            // SQL-backed collections the loader reads — a Firestore collection
            // has nothing to generate, push or check for drift. Tracked across the
            // debounce window because one burst can touch both kinds of file.
            let sqlSchemaAffected = false;
            let changed = "";
            const collectionsChanged = (filename: string, affectsSchema: boolean): void => {
                sqlSchemaAffected = sqlSchemaAffected || affectsSchema;
                changed = filename;
                if (debounce) clearTimeout(debounce);
                debounce = setTimeout(() => {
                    const regenerateSchema = sqlSchemaAffected;
                    sqlSchemaAffected = false;
                    void (async () => {
                        if (!regenerateSchema) {
                            await regenerateSdkFor(resolvedBackendPort ?? startPort);
                            restartBackend();
                            return;
                        }
                        // The box is drawn at a fixed width, so a name longer
                        // than the cell would push the right border off.
                        const shown = changed.length > 31 ? `…${changed.slice(-30)}` : changed.padEnd(31);
                        console.log([
                            "",
                            chalk.yellow("  ┌──────────────────────────────────────────────────────────────┐"),
                            chalk.yellow("  │  🔄 Collection file changed: ") + chalk.white(shown) + chalk.yellow("│"),
                            chalk.yellow("  │     Regenerating the schema and the SDK types…               │"),
                            chalk.yellow("  └──────────────────────────────────────────────────────────────┘")
                        ].join("\n"));

                        const schemaBefore = generatedSchemaStamp();
                        await Promise.all([ensureGeneratedSchema(projectRoot), regenerateSdkFor(resolvedBackendPort ?? startPort)]);
                        // The stock runtime imports the generated schema, so tsx
                        // already restarts when it is written; a second restart
                        // from the trigger is exactly what this avoids.
                        // Otherwise — nothing was written, a file that did not
                        // exist at boot (so nothing imported it, and tsx is not
                        // watching it), or an ejected entrypoint that may not
                        // import it — dev restarts the backend itself.
                        if (!(usesStockRuntime && schemaBefore !== null && generatedSchemaStamp() !== schemaBefore)) restartBackend();

                        console.log([
                            chalk.green("  ✓ Schema and SDK types regenerated. The backend restarts and boot"),
                            chalk.green("    creates what is missing — a new collection, a new property."),
                            // `db push` is the remedy for what boot leaves alone, on the
                            // managed database as on your own PostgreSQL.
                            chalk.gray("    For what boot leaves alone — a renamed column, a narrowed type,"),
                            chalk.gray(`    a removed field — run ${chalk.cyan("rebase db push")}.`),
                            ""
                        ].join("\n"));
                    })();
                }, 500);
            };
            const watchCollections = (): void => {
                fs.watch(collectionsDir, { recursive: true }, (_eventType, filename) => {
                    if (!filename || filename.startsWith(".") || filename.endsWith(".tmp")) return;
                    collectionsChanged(filename, affectsSqlSchema(collectionsDir, filename));
                });
            };
            if (fs.existsSync(collectionsDir)) {
                watchCollections();
            } else {
                // A headless project has none until `rebase schema introspect`
                // writes them. They are new to the backend as a whole, so they
                // count as a schema change.
                whenDirectoryAppears(collectionsDir, projectRoot, () => {
                    watchCollections();
                    collectionsChanged(`${path.basename(collectionsDir)}/`, true);
                });
            }
        }

        // The admin panel beside the backend, when the port it will bind is
        // already known — so the time to it is the slower of the two starts,
        // not their sum. Otherwise it waits for "Server running at" below.
        if (!backendOnly && frontendDir
            && await frontendCanStartWithBackend({ projectRoot, port: startPort, pinned: portIsPinned })) {
            frontendLaunched = true;
            startFrontend(startPort);
        }

        const backendChild = execa(
            tsxBin,
            watchArgs,
            {
                cwd: backendDir,
                stdio: ["inherit", "pipe", "pipe"],
                env,
                shell: true,
                detached: process.platform !== "win32"
            }
        );
        backendChild.catch(() => {}); // prevent unhandled promise rejection on exit

        /**
         * Whether the backend ever said "Server running at".
         *
         * The one fact this command has about whether the thing it started
         * works. Without it, a backend that threw on boot left `rebase dev`
         * printing "Press Ctrl+C to stop all servers." under a stack trace, as
         * if everything were fine — and `tsx watch` keeps its own process alive
         * after the entry crashes, so nothing exits to contradict it.
         */
        let backendAnnounced = false;

        /**
         * A boot that lost its database part-way is booted again, a few
         * times, instead of waiting for a file change. See utils/boot-retry.ts:
         * a `rebase db branch create --force` that lands while the backend
         * boots ends its connections, and nothing in the project is wrong.
         */
        const bootRetry = new BootRetry();
        const retryPassingBootFailure = (line: string): void => {
            if (!usableTrigger || shuttingDown) return;
            const plan = bootRetry.line(stripAnsi(line));
            if (!plan) return;
            setTimeout(() => {
                if (shuttingDown || backendAnnounced) return;
                console.log(chalk.gray(`  ↻ The backend lost its database while it was starting; starting it again (${plan.attempt} of ${plan.of}).`));
                restartBackend();
            }, plan.delayMs).unref?.();
        };

        /** The verdict, printed once per failure rather than once per line. */
        let backendDownReported = false;
        const reportBackendDown = (headline: string) => {
            if (shuttingDown || backendDownReported) return;
            backendDownReported = true;
            console.log("");
            console.error(chalk.red(`  ✗ ${headline}`));
            console.error(chalk.gray("    Fix the error above; the watcher restarts it on the next change."));
            console.log("");
            // With a frontend still running there is a server to keep serving,
            // so the run continues and only the message is owed. `--backend-only`
            // has nothing left to do, and a zero exit there tells a script the
            // backend ran fine. Cleared again by the next "Server running at".
            if (backendOnly) process.exitCode = 1;
        };

        /**
         * Say so when the backend is not up.
         *
         * A deadline rather than an exit code, because there is usually no exit
         * to watch: the watcher survives its child and waits for a file change,
         * so a crash is visible only as an absence.
         *
         * Armed once at spawn and **re-armed on every restart**, which is the
         * half that was missing. The old timer fired once, thirty seconds after
         * start-up, and its body began `if (backendAnnounced) return` — so a
         * backend that came up and then died on the next save was covered by
         * nothing at all. Breaking `config/resources.ts` under a running
         * `rebase dev` printed a stack trace, took `/health` to nothing, and
         * left the CLI saying "Press Ctrl+C to stop all servers."
         */
        const readyTimeoutMs = Number(env.REBASE_DEV_READY_TIMEOUT_MS ?? process.env.REBASE_DEV_READY_TIMEOUT_MS ?? 30_000);
        let readyDeadline: NodeJS.Timeout | undefined;
        const disarmReadyDeadline = () => {
            if (readyDeadline) clearTimeout(readyDeadline);
            readyDeadline = undefined;
        };
        const armReadyDeadline = (headline: string) => {
            disarmReadyDeadline();
            if (readyTimeoutMs <= 0) return;
            readyDeadline = setTimeout(() => {
                if (backendAnnounced) return;
                reportBackendDown(headline);
            }, readyTimeoutMs);
            readyDeadline.unref?.();
        };
        const readySeconds = Math.round(readyTimeoutMs / 1000);
        armReadyDeadline(`The backend has not started after ${readySeconds}s.`);

        const noticePortMoved = (line: string): void => {
            const moved = portMovedNotice(line);
            if (!moved) return;
            console.log(`  ${chalk.gray("↳ PORT")} = ${chalk.white(moved.to)} ${chalk.gray(`(${moved.from} was in use)`)}`);
        };

        /**
         * The restart line, on either stream.
         *
         * A restart means the announced backend is gone: it either exited on
         * its own (tsx says "Rerunning") or is being killed (tsx says
         * "Restarting"). Either way the question "is there a server?" is open
         * again, so readiness is un-announced and the deadline re-armed. Without
         * this the flag stayed true forever after the first successful boot.
         *
         * Checked on both streams because which pipe it lands on is tsx's
         * business, and a marker watched on the wrong one never fires.
         */
        const noticeWatcherRestart = (line: string): void => {
            if (!WATCHER_RESTART_MARKER.test(stripAnsi(line))) return;
            backendAnnounced = false;
            backendDownReported = false;
            armReadyDeadline(`The backend did not come back up after ${readySeconds}s.`);
        };

        /**
         * And notice a backend that dies without tsx saying anything.
         *
         * `kill -9` of the server process is the plain case: tsx stays alive,
         * prints nothing, and waits for a file change that may never come.
         * Measured on tsx 4.23.1 — the watcher's transcript after the kill is
         * empty. So the only honest question left is whether anything is still
         * listening on the port the backend announced, and this asks it.
         *
         * Only runs between an announcement and the next restart, so an
         * ordinary restart (where the port is legitimately closed for a second)
         * cannot trip it: `noticeWatcherRestart` clears `backendAnnounced`
         * before the process is killed. Two misses rather than one, because a
         * single refused connect under load is not yet news.
         */
        let missedProbes = 0;
        const liveness = setInterval(() => {
            if (shuttingDown || !backendAnnounced || !resolvedBackendPort) {
                missedProbes = 0;
                return;
            }
            const port = resolvedBackendPort;
            void probeTcp("127.0.0.1", port, 1_000).then(alive => {
                if (!backendAnnounced || resolvedBackendPort !== port) return;
                if (alive) {
                    missedProbes = 0;
                    return;
                }
                if (++missedProbes < 2) return;
                backendAnnounced = false;
                missedProbes = 0;
                reportBackendDown(`The backend stopped listening on port ${port}.`);
            });
        }, LIVENESS_INTERVAL_MS);
        liveness.unref?.();

        /**
         * And say so when tsx itself gives up.
         *
         * Distinct from the deadline above: this is the watcher exiting, not
         * the app under it. It happens when the entry cannot be resolved at
         * all, when node_modules is broken, or when something kills the
         * process — none of which tsx will retry, so the run is over and the
         * exit code should say so.
         */
        backendChild.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
            disarmReadyDeadline();
            clearInterval(liveness);
            backendAnnounced = false;
            // The watcher itself is gone, so this is terminal in a way a failed
            // run is not — worth saying even if a crash was already reported.
            backendDownReported = false;
            reportBackendDown(signal
                ? `Backend was killed by ${signal}.`
                : `Backend exited with code ${code ?? 1}.`);
            if (backendOnly) process.exitCode = code ?? 1;
        });

        forEachOutputLine(backendChild.stdout, (line) => {
            console.log(`${chalk.cyan.bold("[backend]")}  ${line}`);
            noticeWatcherRestart(line);
            noticePortMoved(line);
            retryPassingBootFailure(line);
            const cleanLine = stripAnsi(line);
            const swaggerMatch = cleanLine.match(/Swagger UI available.*"path":"([^"]+)"/);
            if (swaggerMatch) swaggerPath = swaggerMatch[1];

            const serverMatch = cleanLine.match(/Server running at http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
            if (serverMatch) {
                backendAnnounced = true;
                backendDownReported = false;
                missedProbes = 0;
                bootRetry.up();
                // The backend is up, so an earlier failure is no longer the
                // answer this run gives.
                if (backendOnly) process.exitCode = 0;
                disarmReadyDeadline();
                resolvedBackendPort = parseInt(serverMatch[1], 10);
                backendUrl = "started";

                // Start frontend now that we know the real port — or, when it
                // started beside the backend, make sure it was told this one.
                // Before the banner: a restart clears the frontend URL, and the
                // banner then waits for the new one.
                if (!backendOnly && frontendDir) {
                    if (!frontendLaunched) {
                        frontendLaunched = true;
                        startFrontend(resolvedBackendPort);
                    } else if (!frontendPortChecked && frontendApiPort !== resolvedBackendPort) {
                        void restartFrontend(resolvedBackendPort);
                    }
                    frontendPortChecked = true;
                }
                printSummary();

                // Save the url to a temp file for scripts to pick up
                const urlFile = path.join(projectRoot, ".rebase-dev-url");
                fs.writeFileSync(urlFile, `http://localhost:${resolvedBackendPort}`, "utf-8");

                // Save the port to .rebase-dev-port for port affinity
                const portFile = path.join(projectRoot, DEV_PORT_FILENAME);
                fs.writeFileSync(portFile, devPortFileContents(resolvedBackendPort, startPort), "utf-8");

                // The SDK README names the port the backend was told; one that
                // moved past a collision gets the port it actually bound.
                if (sdkBackendPort !== null && sdkBackendPort !== resolvedBackendPort) {
                    void regenerateSdkFor(resolvedBackendPort);
                }
            }
        });

        /** Whether we've already shown a corrupted-modules recovery hint. */
        let corruptedModulesWarned = false;

        forEachOutputLine(backendChild.stderr, (line) => {
            console.log(`${chalk.cyan.bold("[backend]")}  ${line}`);

            noticeWatcherRestart(line);
            noticePortMoved(line);
            retryPassingBootFailure(line);

            // Detect corrupted node_modules at runtime
            // (covers tsx and any other dependency whose pnpm store entry is broken)
            if (!corruptedModulesWarned) {
                const cleanLine = stripAnsi(line);
                if (
                    cleanLine.includes("Cannot find module") &&
                    cleanLine.includes("node_modules/.pnpm/")
                ) {
                    corruptedModulesWarned = true;
                    // Delay slightly so the full Node.js error stack prints first
                    setTimeout(() => {
                        const pm = detectPackageManager(projectRoot);
                        const installCmd = getPMCommands(pm).install.join(" ");
                        console.error("");
                        console.error(chalk.red("  ✗ node_modules appears corrupted — a required file is missing."));
                        console.error(chalk.gray("    This usually happens when a previous install was interrupted"));
                        console.error(chalk.gray("    or the package manager store was cleaned."));
                        console.error("");
                        console.error(chalk.gray("    To fix, stop the dev server and run:"));
                        console.error(chalk.cyan(`      rm -rf node_modules && ${installCmd}`));
                        console.error("");
                    }, 200);
                }
            }
        });

        children.push(backendChild);
    } else if (!frontendOnly && !backendDir) {
        console.warn(chalk.yellow("  ⚠ No backend/ directory found, skipping backend."));
    }

    // Start frontend immediately if backend-only mode or no backend
    if (!backendOnly && frontendDir && (frontendOnly || !backendDir)) {
        startFrontend(null);
    } else if (!backendOnly && !frontendDir && declaresStaticApp) {
        console.warn(chalk.yellow("  ⚠ No frontend/ directory found, skipping frontend."));
    }

    if (children.length === 0) {
        console.error(chalk.red("  ✗ Nothing to start. Check your project structure."));
        process.exit(1);
    }

    console.log("");
    console.log(chalk.gray("  Press Ctrl+C to stop all servers."));
    console.log("");

    // Wait for all children to exit — including an admin panel restarted on
    // the backend's real port, which joins `children` after this wait began.
    const awaited = new Set<ResultPromise>();
    for (let pending = [...children]; pending.length > 0; pending = children.filter((child) => !awaited.has(child))) {
        for (const child of pending) awaited.add(child);
        // Settled either way: a child that is killed rejects, and `finally`
        // would hand that rejection on to a promise nothing catches.
        await Promise.all(pending.map((child) => child.then(() => undefined, () => undefined)));
    }
}

function printDevHelp() {
    console.log(`
${chalk.bold("rebase dev")} — Start the development server

${chalk.green.bold("Usage")}
  rebase dev [options]

${chalk.green.bold("Options")}
  ${chalk.blue("--backend-only, -b")}    Only start the backend server
  ${chalk.blue("--frontend-only, -f")}   Only start the frontend server
  ${chalk.blue("--port, -P")}            Backend port (default: auto-detected per project)
  ${chalk.blue("--database-url")} ${chalk.gray("<url>")}  Use this Postgres, ahead of everything else
  ${chalk.blue("--docker")}              Use the project's docker-compose ${chalk.gray("db")} service
  ${chalk.blue("--no-db")}               Start no database at all

${chalk.green.bold("Which database")}
  Ordered, and the order is the promise. The first of these that says
  something wins:

    1. ${chalk.blue("--database-url <url>")}    on this command line
    2. ${chalk.gray("DATABASE_URL")}            in the shell environment
    3. the branch this checkout is switched to ${chalk.gray("(rebase db branch switch)")}
    4. ${chalk.gray("DATABASE_URL")}            in the project's .env
    5. ${chalk.blue("--docker")}                on this command line
    6. the managed development database ${chalk.gray("(PGlite, data in .rebase/)")}

  A scaffolded project sets none of 1–5, so it lands on (6): no Docker,
  nothing to install, and the collections' tables are created at boot.

  ${chalk.blue("--docker")} reaches the ${chalk.gray("db")} service in this project's docker-compose.yml,
  starting the container if nothing is listening on its port, and pushing
  the schema when this command is what started it. Its connection string
  is derived from the compose file and ${chalk.gray("DATABASE_PASSWORD")} in .env — the same
  string .env carries, commented out, as ${chalk.gray("DATABASE_URL")}. Any of 1–4
  outranks it, and then nothing is started and a line says ${chalk.blue("--docker")} was ignored.

  The choice is remembered: after ${chalk.blue("rebase dev --docker")}, ${chalk.cyan("rebase db url")}, ${chalk.cyan("db push")},
  ${chalk.cyan("console")} and the rest use the Docker database too, at rule 5. The next
  ${chalk.cyan("rebase dev")} without ${chalk.blue("--docker")} goes back to the managed database, and so do they.

  A database that is already running is never touched: no schema push,
  no connection. A DATABASE_URL pointing anywhere other than this machine
  is left alone entirely. Pass ${chalk.blue("--no-db")}, or set REBASE_DEV_NO_DB=1, to
  start nothing — the backend then fails on the database it cannot reach,
  which is the point.

${chalk.green.bold("Which port")}
  Ordered like the database, and the order is the promise. The first of
  these that says something wins, and the start banner names which one did:

    1. ${chalk.blue("--port <n>")}              on this command line
    2. ${chalk.gray("PORT")}                    in the shell environment
    3. the port the last ${chalk.gray("rebase dev")} used ${chalk.gray("(.rebase-dev-port)")}
    4. a port derived from this project's path

  ${chalk.gray("PORT")} in the project's .env is ${chalk.bold("not")} read here: this command resolves
  its port before .env is loaded and then sets ${chalk.gray("PORT")} for the backend from
  what it resolved. Export it in your shell, or pass ${chalk.blue("--port")}.

${chalk.green.bold("Description")}
  Starts both the backend (tsx watch + Hono) and frontend (Vite)
  dev servers concurrently with color-coded output prefixes.

  Each project automatically receives a unique default port derived
  from its directory path, preventing collisions when running multiple
  Rebase instances simultaneously.

  If the assigned port is already in use, the server will automatically
  try the next available port. The frontend starts beside the backend
  when the backend's port is known in advance (named with --port, or
  free), and after the backend is ready otherwise. Either way
  VITE_API_URL is injected with the port the backend actually bound —
  the frontend is restarted if the backend had to move.

  On startup and on every save under config/collections, the Drizzle
  schema (backend/src/schema.generated.ts) and the SDK types
  (generated/sdk) are regenerated from the collections.

  An edit to .env restarts the backend, which reads the file again. What
  this command sets for it is kept until ${chalk.cyan("rebase dev")} restarts: ${chalk.gray("PORT")}, and
  ${chalk.gray("DATABASE_URL")} on the managed or the Docker database.
`);
}
