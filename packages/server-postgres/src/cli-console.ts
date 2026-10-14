/**
 * `rebase console` — the driver's half.
 *
 * Loads the project's collections the way `rebase db push` does, opens the
 * database with {@link openRebase}, and either evaluates one piece of code
 * (`--eval`) or starts a Node REPL with `rebase` and `collections` in scope.
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
import { inspect } from "node:util";
import { setLogOutput } from "@rebasepro/server";
import type { CollectionConfig } from "@rebasepro/types";
import { RELAYED_FLAGS } from "./cli-flags";
import { out, outError, describeFailure } from "./cli-output";
import { poolMaxCeiling } from "./connection";
import { openRebase, type OpenedRebase } from "./open-rebase";

/**
 * The flags `rebase console` takes. `--history` is the CLI's own: where it
 * keeps the REPL's history (`.rebase/console_history` in the project).
 */
export const CONSOLE_FLAGS = {
    "--collections": String,
    "-c": "--collections",
    "--eval": String,
    "-e": "--eval",
    "--history": String
} satisfies arg.Spec;

/** What the code the console runs can name. */
export interface ConsoleScope {
    rebase: OpenedRebase;
    collections: CollectionConfig[];
}

type ScopedFunction = (rebase: OpenedRebase, collections: CollectionConfig[]) => Promise<unknown>;
type AsyncFunctionConstructor = new (...parameters: string[]) => ScopedFunction;

/** The constructor of `async function` — what `new Function` is for a body that awaits. */
const AsyncFunction: AsyncFunctionConstructor = Object.getPrototypeOf(async () => undefined).constructor;

/**
 * Run `code` with `rebase` and `collections` in scope and resolve with its
 * value.
 *
 * Read as an expression first, so `rebase.dataAsAdmin.posts.find()` is its own
 * result; code that is not one expression runs as a function body, where
 * `await` works everywhere and `return` gives the result.
 */
export async function evaluateInConsole(code: string, scope: ConsoleScope): Promise<unknown> {
    let run: ScopedFunction;
    try {
        run = new AsyncFunction("rebase", "collections", `return (${code}\n);`);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        run = new AsyncFunction("rebase", "collections", code);
    }
    return run(scope.rebase, scope.collections);
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
 * `rebase console [--eval <code>] [--collections <dir>]`, from the driver
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
            collections: flags["--collections"],
            eval: flags["--eval"],
            history: flags["--history"]
        }, streams);
    } finally {
        setLogOutput();
    }
}

/** Open the project, run `--eval` or the REPL, and close it again. Resolves with the exit code. */
async function openAndRun(
    options: { databaseUrl: string; collections?: string; eval?: string; history?: string },
    streams: ConsoleStreams
): Promise<number> {
    const { databaseUrl } = options;
    const collectionsPath = path.resolve(options.collections || path.join("..", "config", "collections"));
    const { loadCollections } = await import("./schema/doctor");
    const collections = fs.existsSync(collectionsPath) ? await loadCollections(collectionsPath) : [];

    const ceiling = poolMaxCeiling();
    const rebase = await openRebase({
        databaseUrl,
        collections,
        ...(ceiling !== null ? { pool: { max: ceiling } } : {})
    });

    try {
        const code = options.eval;
        if (code !== undefined) {
            try {
                const result = await evaluateInConsole(code, { rebase, collections: rebase.collections });
                if (result !== undefined) out(consoleJson(result));
                return 0;
            } catch (error) {
                outError(describeFailure(error));
                return 1;
            }
        }

        await startRepl({ rebase, collections: rebase.collections }, {
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
    say(`  rebase console — ${options.database}, ${scope.collections.length} collection(s)`);
    say("  In scope: rebase (dataAsAdmin, sql, withAuth, close) and collections. Top-level await works.");
    say("  Try: await rebase.dataAsAdmin.<collection>.find({ limit: 5 })");
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
    server.context.collections = scope.collections;
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
