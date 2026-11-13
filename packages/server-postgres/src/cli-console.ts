/**
 * `rebase console` — the driver's half.
 *
 * Loads the project's tables (`backend/schema`) the way `rebase db push` does,
 * and the global table hooks `backend/hooks.ts` exports, opens the database with
 * {@link openRebase}, and either evaluates one piece of code
 * (`--eval`) or starts a Node REPL with `rebase` and `tables` in scope.
 * The `rebase` CLI resolves the database first (the managed one included) and
 * hands this process `DATABASE_URL`, exactly as it does for `db` commands.
 *
 * This is the boot side of `openRebase`: it is where the environment is read
 * — `DATABASE_URL`, and the `REBASE_DB_POOL_MAX` ceiling the managed
 * development database needs — and turned into explicit options.
 */
import arg from "arg";
import fs from "fs";
import path from "path";
import readline from "node:readline";
import repl from "node:repl";
import { PassThrough } from "node:stream";
import tty from "node:tty";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { setLogOutput } from "@rebasepro/server";
import type { TableDescriptor, TableHooks } from "@rebasepro/types";
import { RELAYED_FLAGS } from "./cli-flags";
import { DEFAULT_SCHEMA_DIR } from "./cli-schema-dir";
import { diagnoseDbError } from "./cli-errors";
import { out, outError, describeFailure } from "./cli-output";
import { poolMaxCeiling } from "./connection";
import { openRebase, type OpenedRebase } from "./open-rebase";

/**
 * The flags `rebase console` takes. `--history` is the CLI's own: where it
 * keeps the REPL's history (`.rebase/console_history` in the project).
 */
export const CONSOLE_FLAGS = {
    "--schema-dir": String,
    "--eval": String,
    "-e": "--eval",
    "--history": String
} satisfies arg.Spec;

/** What the code the console runs can name. */
export interface ConsoleScope {
    rebase: OpenedRebase;
    /** The descriptors of the tables the project serves. */
    tables: TableDescriptor[];
}

type ScopedFunction = (rebase: OpenedRebase, tables: TableDescriptor[]) => Promise<unknown>;
type AsyncFunctionConstructor = new (...parameters: string[]) => ScopedFunction;

/** The constructor of `async function` — what `new Function` is for a body that awaits. */
const AsyncFunction: AsyncFunctionConstructor = Object.getPrototypeOf(async () => undefined).constructor;

/**
 * Run `code` with `rebase` and `tables` in scope and resolve with its
 * value.
 *
 * Read as an expression first, so `rebase.dataAsAdmin.posts.find()` is its own
 * result; code that is not one expression runs as a function body, where
 * `await` works everywhere and `return` gives the result.
 */
export async function evaluateInConsole(code: string, scope: ConsoleScope): Promise<unknown> {
    let run: ScopedFunction;
    try {
        run = new AsyncFunction("rebase", "tables", `return (${code}\n);`);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        run = new AsyncFunction("rebase", "tables", code);
    }
    return run(scope.rebase, scope.tables);
}

/** A result as JSON, the way `--eval` prints it: dates as ISO strings, bigints as strings. */
export function consoleJson(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item, 2) ?? "undefined";
}

/** The host and database a URL names, for the banner — never its credentials. */
function describeDatabase(databaseUrl: string): string {
    try {
        const url = new URL(databaseUrl);
        return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
    } catch {
        return "the configured database";
    }
}

/** Where the REPL reads and writes; the terminal unless a caller hands it streams. */
export interface ConsoleStreams {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}

/**
 * `rebase console [--eval <code>] [--schema-dir <dir>]`, from the driver
 * line `["console", …flags]`. Resolves with the exit code.
 */
export async function consoleCommand(args: string[], streams: ConsoleStreams = {}): Promise<number> {
    const flags = arg({ ...RELAYED_FLAGS, ...CONSOLE_FLAGS }, { argv: args.slice(1) });
    if (flags["--help"]) {
        out("Run `rebase console --help` for the options — this is the driver's own entry point.");
        return 0;
    }

    const databaseUrl = flags["--database-url"] || process.env.DATABASE_URL;
    if (!databaseUrl) {
        outError("✗ No database to open: DATABASE_URL is not set. Set it in .env, or pass --database-url.");
        return 1;
    }

    // The console's own lines are what the reader is here for; the driver's
    // info-level boot notes are not, unless they asked for them.
    if (process.env.LOG_LEVEL === undefined) process.env.LOG_LEVEL = "warn";

    // And whatever level they asked for, a log line is never part of the
    // answer: stdout holds the `--eval` result a pipe reads (`| jq .`) and the
    // REPL's values. The scaffold's `.env` sets LOG_LEVEL=info, and under
    // NODE_ENV=production warnings go to stdout too.
    setLogOutput("stderr");
    try {
        return await openAndRun({
            databaseUrl,
            schemaDir: flags["--schema-dir"],
            eval: flags["--eval"],
            history: flags["--history"]
        }, streams);
    } finally {
        setLogOutput();
    }
}

/** Whether a connection was reset or cut off before it answered, anywhere in the error's chain. */
function connectionCutOff(error: unknown, depth = 0): boolean {
    if (!error || typeof error !== "object" || depth > 4) return false;
    if ("code" in error && error.code === "ECONNRESET") return true;
    if (error instanceof Error && /Connection terminated unexpectedly/.test(error.message)) return true;
    if ("errors" in error && Array.isArray(error.errors) && error.errors.some(inner => connectionCutOff(inner, depth + 1))) return true;
    return "cause" in error && connectionCutOff(error.cause, depth + 1);
}

/** Whether Postgres refused the connection for want of one: SQLSTATE 53300, anywhere in the error's chain. */
function noFreeConnection(error: unknown, depth = 0): boolean {
    if (!error || typeof error !== "object" || depth > 4) return false;
    if ("code" in error && error.code === "53300") return true;
    return "cause" in error && noFreeConnection(error.cause, depth + 1);
}

/**
 * What the console says when the project's database will not open: the banner
 * every db command prints for a database it cannot reach, or one sentence —
 * never the driver's error serialised onto one line, stack and all.
 *
 * The managed development database accepts only a few connections at a time,
 * and a running `rebase dev` holds some of them. Its proxy refuses one over the
 * limit with SQLSTATE 53300; a database an earlier CLI started resets it
 * instead, and `read ECONNRESET` says nothing about why.
 */
export function describeOpenFailure(error: unknown, databaseUrl: string, managed: boolean): string {
    if (managed && (connectionCutOff(error) || noFreeConnection(error))) {
        return "✗ The managed development database has no free connection: it accepts only a few at a time, " +
            "and other clients hold them — a running `rebase dev` holds some.\n" +
            "  Close another `rebase console`, psql or database GUI and run this again, " +
            "or stop `rebase dev` while you use the console.";
    }
    return diagnoseDbError(error, databaseUrl) ?? describeFailure(error);
}

/** The names a table hook can have; anything else on a `hooks` export is not one. */
const TABLE_HOOK_NAMES = ["beforeQuery", "afterRead", "beforeSave", "afterSave", "afterSaveError", "beforeDelete", "afterDelete"] as const;

/** Whether a module's `hooks` export is table hooks: an object whose every key is a hook name holding a function. */
function isTableHooks(value: unknown): value is TableHooks {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    return Object.entries(value).every(([key, hook]) =>
        (TABLE_HOOK_NAMES as readonly string[]).includes(key) && (hook === undefined || typeof hook === "function"));
}

/**
 * The project's global table hooks: the `hooks` its `backend/hooks.ts`
 * exports, which the server runs for every table ahead of each table's own.
 *
 * `backend/` is the schema directory's parent. No module there means no global
 * hooks, as it does for the server.
 *
 * One that is there and cannot be imported — an import that needs an
 * environment variable the console was not given, say — does not stop the
 * console, which can still read and write. It says so, once, and runs without
 * them: writes from this session then skip the global tier, and the reader
 * knows it.
 *
 * They are handed on as declared: the driver calls each with the descriptor
 * of the table it runs for.
 *
 * @param schemaDir the schema directory, absolute.
 */
export async function loadProjectHooks(schemaDir: string): Promise<TableHooks | undefined> {
    const backendDir = path.dirname(schemaDir);
    // `.js` first, as the server's own loader reads a built module.
    const modulePath = [".js", ".mjs", ".ts", ".mts"]
        .map(ext => path.join(backendDir, `hooks${ext}`))
        .find(candidate => fs.existsSync(candidate));
    if (!modulePath) return undefined;

    let mod: Record<string, unknown>;
    try {
        mod = await import(pathToFileURL(modulePath).href);
    } catch (error) {
        const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0];
        outError(`⚠ Global hooks are off in this session: ${modulePath} could not be loaded (${reason}). Each table's own hooks still run.`);
        return undefined;
    }
    if (mod.hooks === undefined) return undefined;
    if (!isTableHooks(mod.hooks)) {
        outError(`⚠ Global hooks are off in this session: the \`hooks\` ${modulePath} exports is not an object of table hooks (${TABLE_HOOK_NAMES.join(", ")}).`);
        return undefined;
    }
    return mod.hooks;
}

/** Open the project, run `--eval` or the REPL, and close it again. Resolves with the exit code. */
async function openAndRun(
    options: { databaseUrl: string; schemaDir?: string; eval?: string; history?: string },
    streams: ConsoleStreams
): Promise<number> {
    const { databaseUrl } = options;
    // The tables the way every other driver command reads them: a schema that
    // does not compile stops the console too, rather than opening it over a
    // subset of the tables.
    const { loadTableSchema } = await import("./schema/load-tables");
    const schemaDir = path.resolve(options.schemaDir || DEFAULT_SCHEMA_DIR);
    const { tables } = await loadTableSchema(schemaDir);
    // Writes from the console run the same hook tiers as a server write.
    const hooks = await loadProjectHooks(schemaDir);

    const ceiling = poolMaxCeiling();
    let rebase: OpenedRebase;
    try {
        rebase = await openRebase({
            databaseUrl,
            tables,
            ...(hooks ? { hooks } : {}),
            ...(ceiling !== null ? { pool: { max: ceiling } } : {})
        });
    } catch (error) {
        outError(describeOpenFailure(error, databaseUrl, process.env.REBASE_DEV_DATABASE_KIND === "managed"));
        return 1;
    }

    try {
        const code = options.eval;
        if (code !== undefined) {
            try {
                const result = await evaluateInConsole(code, { rebase, tables: rebase.tables });
                if (result !== undefined) out(consoleJson(result));
                return 0;
            } catch (error) {
                outError(describeFailure(error));
                return 1;
            }
        }

        await startRepl({ rebase, tables: rebase.tables }, {
            history: options.history,
            database: describeDatabase(databaseUrl),
            ...streams
        });
        return 0;
    } finally {
        await rebase.close();
    }
}

/** The interactive half: a Node REPL until `.exit`, Ctrl-D or the end of piped input. */
async function startRepl(scope: ConsoleScope, options: { history?: string; database: string } & ConsoleStreams): Promise<void> {
    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    const typed = input instanceof tty.ReadStream && input.isTTY;

    // For a person at a terminal. Piped, stdout is the REPL's answers, which
    // whatever reads the pipe is after, so the banner goes to stderr with the
    // rest of what the console says about itself.
    const say = typed ? out : outError;
    say("");
    say(`  rebase console — ${options.database}, ${scope.tables.length} table(s)`);
    say("  In scope: rebase (dataAsAdmin, sql, withAuth, close) and tables. Top-level await works.");
    say("  Try: await rebase.dataAsAdmin.<table>.find({ limit: 5 })");
    say("");

    // Typed at a terminal, the REPL reads it as one. Anything else — a pipe, a
    // file, a stream handed in — reaches it a line at a time through `feed`
    // (see `feedLineByLine`).
    const feed = typed ? undefined : new PassThrough();
    // Colours for a terminal only: piped to a file or another program, the
    // escape codes are noise in the text.
    const colors = output instanceof tty.WriteStream && output.isTTY;
    // Started without a prompt, and given one once the scope is in place: a
    // line that arrives with the first prompt must already see `rebase`.
    const server = repl.start({
        prompt: "",
        useGlobal: false,
        ...(feed ? { input: feed, output, terminal: false } : { input, output }),
        writer: (value: unknown) => inspect(value, { colors, depth: 6 })
    });
    server.context.rebase = scope.rebase;
    server.context.tables = scope.tables;
    server.setPrompt("rebase> ");

    const history = options.history;
    if (history) {
        fs.mkdirSync(path.dirname(history), { recursive: true });
        await new Promise<void>((resolve) => {
            server.setupHistory(history, (error) => {
                if (error) outError(`  (history is off: ${error.message})`);
                resolve();
            });
        });
    }

    const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
    server.displayPrompt();
    if (feed) await feedLineByLine(input, server, feed, exited);
    await exited;
}

/**
 * Hand input that is not typed at a terminal to the REPL a line at a time,
 * each once the REPL has finished the one before.
 *
 * Typed, the REPL holds keystrokes back while a top-level `await` is pending.
 * Piped, every line arrives at once and each is evaluated as it arrives, so in
 * `const { data } = await …` followed by `data.map(…)` the second line read
 * `data` before the first had assigned it.
 *
 * The REPL is paused as each line reaches it, and it resumes its input when it
 * displays its prompt again: once the line's value has settled, its error has
 * been printed, or it needs the next line to complete it. That resumption is
 * when the next line goes in. Lines are written one per chunk, because a
 * chunk holding several is split and every line of it handed over at once.
 */
async function feedLineByLine(
    source: NodeJS.ReadableStream,
    server: repl.REPLServer,
    feed: PassThrough,
    exited: Promise<void>
): Promise<void> {
    let evaluated: (() => void) | undefined;
    const ready = () => {
        const resolve = evaluated;
        evaluated = undefined;
        resolve?.();
    };
    // Before the REPL's own handler, so a line it evaluates at once resumes
    // after this pause rather than before it.
    server.prependListener("line", () => {
        if (!server.editorMode) server.pause();
    });
    // `.editor` collects lines with no prompt until Ctrl-D: they go straight in.
    server.on("line", () => {
        if (!server.editorMode) return;
        server.resume();
        ready();
    });
    server.on("resume", ready);

    const closed = exited.then(() => "closed" as const);
    const lines = readline.createInterface({ input: source, crlfDelay: Infinity });
    for await (const line of lines) {
        const done = new Promise<"done">((resolve) => { evaluated = () => resolve("done"); });
        feed.write(`${line}\n`);
        // `.exit`: the rest of the input is not for this REPL.
        if (await Promise.race([done, closed]) === "closed") break;
    }
    feed.end();
}
