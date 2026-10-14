/**
 * CLI command: rebase console
 *
 * A Node REPL with the project open — `rebase` (what `openRebase` from
 * `@rebasepro/server-postgres` returns: `dataAsAdmin`, `sql`, `withAuth`) and
 * `collections` in scope — or, with `--eval`, one piece of code run and its
 * result printed as JSON.
 *
 * Resolved like `rebase db push`: the same project and `.env`, the same
 * database (the managed one started if that is what the project uses), the
 * same `--collections` loader — the driver's, spawned in `backend/`. Opening
 * the database changes nothing in it.
 */
import chalk from "chalk";
import path from "path";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import { argsFromCommand } from "../utils/command-words";
import { COLLECTIONS_FLAG_HELP, refuseMissingCollectionsPath } from "../utils/path-flags";
import { reportSpawnFailure } from "../utils/spawn-error";
import { managedNotices, prepareDatabaseEnv } from "../dev-db/prepare";
import { absolutizeLocalPathArgs, ensureDockerDatabase, resolveDriverCli, spawnDriverCli } from "./db";

export const CONSOLE_FLAGS = {
    "--eval": String,
    "-e": "--eval",
    "--collections": String,
    "-c": "--collections",
    "--database-url": String,
    "--docker": Boolean
} as const;

/** What each long flag above does, for the Options block. */
const CONSOLE_FLAG_HELP: Record<string, string> = {
    "--eval": "Run this code instead of the REPL, print its awaited result as JSON, and exit 1 if it throws",
    "--collections": COLLECTIONS_FLAG_HELP,
    "--database-url": "Open this database instead of the project's",
    "--docker": "Use the database from docker compose, starting it if needed"
};

/** Where the REPL keeps its history: the project's own `.rebase/`, which the scaffold ignores. */
export function consoleHistoryPath(projectRoot: string): string {
    return path.join(projectRoot, ".rebase", "console_history");
}

function flagLabel(flag: string): string {
    const aliases = Object.entries(CONSOLE_FLAGS)
        .filter(([, target]) => target === flag)
        .map(([alias]) => alias);
    return [flag, ...aliases].join(", ");
}

export function printConsoleHelp(): void {
    console.log(`
${chalk.bold("rebase console")} — Explore the project's data from a REPL

${chalk.green.bold("Usage")}
  rebase console [options]

${chalk.green.bold("Options")}
${Object.keys(CONSOLE_FLAG_HELP)
        .map(flag => `  ${chalk.blue(flagLabel(flag).padEnd(22))} ${CONSOLE_FLAG_HELP[flag]}`)
        .join("\n")}

In scope:
  rebase        dataAsAdmin, sql(query, { params }), withAuth(user) → { data }, close()
  collections   the project's collections

Top-level await works. Opening the database changes nothing in it: no table,
role or trigger is created. withAuth runs as the user under row-level security.

${chalk.green.bold("Examples")}
  rebase console
  rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
  rebase console -e "(await rebase.withAuth({ uid: 'u1', roles: ['user'] })).data.posts.find()"
  rebase console -e "rebase.sql('select count(*) from posts')"
`);
}

export async function consoleCommand(rawArgs: string[]): Promise<void> {
    if (wantsHelp(rawArgs)) {
        printConsoleHelp();
        return;
    }

    // Strictly, before the line is relayed: the driver would otherwise be the
    // first to see a mistyped flag, after a database had been started for it.
    const { flags } = parseCommandArgs({
        spec: CONSOLE_FLAGS,
        rawArgs,
        commandWords: 1,
        command: "console",
        maxPositionals: 0
    });

    const resolved = await resolveDriverCli();
    const { projectRoot, backendDir } = resolved;
    refuseMissingCollectionsPath(rawArgs, process.cwd(), backendDir, "console");
    await ensureDockerDatabase(projectRoot, rawArgs);

    // With --eval, stdout is the result and nothing else, so it can be piped
    // into `jq`; piped into the REPL, it is the REPL's answers. Either way what
    // the database resolution has to say goes to stderr.
    const say = flags["--eval"] === undefined && process.stdin.isTTY
        ? (line: string) => console.log(chalk.gray(`  ${line}`))
        : (line: string) => console.error(chalk.gray(`  ${line}`));
    const prepared = await prepareDatabaseEnv(projectRoot, {
        flagUrl: flags["--database-url"] ?? null,
        flagDocker: flags["--docker"] === true,
        onProgress: say
    });
    Object.assign(resolved.env, prepared.env);
    for (const line of managedNotices(prepared)) say(line);

    const childArgs = [
        ...absolutizeLocalPathArgs(argsFromCommand(rawArgs, "console"), process.cwd()),
        `--history=${consoleHistoryPath(projectRoot)}`
    ];

    try {
        await spawnDriverCli(resolved, childArgs);
    } catch (error) {
        // A child that exited non-zero has already said why, on the terminal it
        // shares — an `--eval` that threw, a database that refused.
        reportSpawnFailure(error);
        process.exit(1);
    }
}
