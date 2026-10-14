/**
 * The one place a command asks "which database, and how do I reach it?".
 *
 * Every command that touches Postgres — `dev`, and the whole `db` namespace
 * through the driver plugin — goes through {@link prepareDatabaseEnv}. It
 * resolves the ordering in `resolve.ts`, starts the managed database if that is
 * what the ordering chose, and hands back the environment additions the child
 * process needs.
 *
 * Two things it deliberately does *not* do:
 *
 * - **It never overwrites an existing `DATABASE_URL`.** When the developer has
 *   named a database, the returned environment is empty and the child inherits
 *   exactly what it would have inherited before this feature existed. A
 *   migration must never be redirected away from the database its author meant.
 *
 * - **It never starts anything for a command that is not going to connect.**
 *   `--help` and argument errors are handled by the caller before this is
 *   reached, because booting a Postgres to print usage would be absurd.
 */

import fs from "fs";
import path from "path";

import { composeDatabaseUrl } from "../utils/dev-preflight";
import { findProjectRoot, readEnvFile } from "../utils/project";
import { Refusal } from "../utils/refusal";
import { resourceEnvSuffix } from "@rebasepro/types";
import { branchUrl, databaseNameOf, readActiveBranch } from "./branch-pointer";
import { readLastDevDocker } from "./last-dev-database";
import { MANAGED_LIMITATIONS, MANAGED_POOL_MAX } from "./constraints";
import { ensureManagedDatabase } from "./daemon";
import { type DevDatabase, describeDevDatabase, outrankedDockerFlagNotice, resolveDevDatabase } from "./resolve";

export interface PrepareOptions {
    /** `--database-url <url>`. */
    flagUrl?: string | null;
    /** `--docker`. */
    flagDocker?: boolean;
    /**
     * Follow the database the last `rebase dev` ran on (`last-dev-database.ts`).
     * On by default; `rebase dev` itself turns it off, because its own flags are
     * the choice being recorded.
     */
    followLastDev?: boolean;
    /** Suppress the "starting…" progress line. */
    quiet?: boolean;
    /** Where human-facing lines go. Defaults to stdout via the caller. */
    onProgress?: (message: string) => void;
    /**
     * Keys of the additional databases the project declares —
     * `database("analytics")` → `analytics`. On the managed path each gets
     * its own PGlite instance and a `DATABASE_URL__<KEY>` in the child's
     * environment, unless the developer set that variable themselves. On an
     * external database nothing is added: whoever chose the database binds
     * the rest of them.
     */
    additionalKeys?: readonly string[];
}

export interface PreparedDatabase {
    /** What the resolver chose, for the banner and for tests. */
    database: DevDatabase;
    /**
     * Variables to add to a child process's environment.
     *
     * Empty for an external database: the child already has what it needs, and
     * adding to it could only do harm.
     */
    env: Record<string, string>;
    /** One line naming the database, suitable for a startup banner. */
    description: string;
    /** Absolute path of the managed data directory, when there is one. */
    dataDir?: string;
    /** True when this call started the managed database rather than finding it. */
    startedDaemon?: boolean;
    /** The additional managed databases, by declared key, when any were asked for. */
    additional?: Record<string, string>;
}

/**
 * The branch this checkout is switched to, over the `DATABASE_URL` in `.env`.
 *
 * Derived rather than stored: the pointer holds a name, and the credentials
 * stay in the one place the developer wrote them. The base here is the
 * project's `.env` — a switch is a statement about *this project's* database,
 * so a `DATABASE_URL` that happens to be in the shell is not the thing being
 * branched, and it outranks the branch anyway.
 *
 * Returns null when there is no branch, and also when `.env` names no base to
 * swap the database name on. That is not the end of it: a project on Postgres
 * in Docker has no `DATABASE_URL` either, and its branch is applied over the
 * compose URL once the order has picked Docker — see
 * {@link resolveProjectDatabaseAndBranch}.
 *
 * Exported for its tests. Asserting this through {@link prepareDatabaseEnv}
 * would start a real PGlite daemon to check a decision made before any daemon
 * is involved.
 */
export function resolveActiveBranch(
    projectRoot: string,
    envFile: Record<string, string>
): { name: string; url: string } | null {
    const active = readActiveBranch(projectRoot);
    if (!active) return null;

    const base = envFile.DATABASE_URL?.trim();
    if (!base) return null;

    const url = branchUrl(base, active.database);

    return url ? { name: active.name, url } : null;
}

/**
 * The compose `db` service's connection string for this project, or null.
 *
 * Read here rather than in `resolve.ts` so the ordering there stays pure, and
 * exported for the commands that feed the resolver themselves (`rebase status`,
 * `db branch switch`). The preflight that starts the container takes the URL
 * from {@link resolveProjectDatabase}, so it starts one only when the order
 * picks Docker.
 */
export function resolveComposeUrl(projectRoot: string, envFile: Record<string, string>): string | null {
    const composePath = path.join(projectRoot, "docker-compose.yml");
    if (!fs.existsSync(composePath)) return null;
    try {
        return composeDatabaseUrl(fs.readFileSync(composePath, "utf8"), envFile);
    } catch {
        return null;
    }
}

/**
 * Which database a project is on, decided without starting anything.
 *
 * `resolveDevDatabase` is pure, so the answer is available to help text and to
 * a driver child alike — and neither should pay for a daemon to learn it. The
 * driver cannot work it out for itself: on the managed path `DATABASE_URL` is a
 * perfectly ordinary connection string to a Postgres on loopback, so a child
 * handed only that has no way to know that `rebase db generate` will be refused.
 *
 * Null when there is no project here, which is legal — `rebase db --help` is
 * answered outside one — and when anything at all goes wrong reading the
 * project, because help text must not fail to print over an unreadable `.env`.
 */
export function devDatabaseKind(projectRoot?: string | null): DevDatabase["kind"] | null {
    try {
        const root = projectRoot ?? findProjectRoot();
        if (!root) return null;

        return resolveProjectDatabase(root).kind;
    } catch {
        return null;
    }
}

/**
 * The database this command resolves to in this project, decided without
 * starting anything: the ordering in `resolve.ts`, fed from the project's
 * `.env`, its branch pointer, its compose file and the last `rebase dev`.
 *
 * The one place those four are read for a resolution, so a command that asks
 * "which database" and a command that then connects to it cannot disagree.
 */
export function resolveProjectDatabase(
    projectRoot: string,
    options: Pick<PrepareOptions, "flagUrl" | "flagDocker" | "followLastDev"> = {}
): DevDatabase {
    return resolveProjectDatabaseAndBranch(projectRoot, options).database;
}

/** The branch a resolution landed on. */
export interface ResolvedBranch {
    /** The name the developer switched to. */
    name: string;
    /** The PostgreSQL database that name refers to. */
    database: string;
    /**
     * The database the branch was taken from, where the branch registry lives:
     * the one the switch swapped the name on.
     */
    parent: string | null;
}

export interface ProjectDatabase {
    database: DevDatabase;
    /** Set when the resolved database is this checkout's branch rather than the main one. */
    branch: ResolvedBranch | null;
    /**
     * The branch this checkout is switched to, when the database resolved to
     * is the managed one — which serves exactly one database, so the switch
     * cannot be honoured and the main database is used instead. Null otherwise.
     */
    ignoredBranch: string | null;
}

/**
 * {@link resolveProjectDatabase}, and which branch the answer is.
 *
 * The switch applies to whichever base the order picks, not to `.env` alone. A
 * project on Postgres in Docker — `rebase dev --docker`, remembered, with the
 * scaffold's `DATABASE_URL` left commented out, which is the setup the docs
 * point to for branching — resolved its branch to nothing, and every command
 * went on using the main database while `switch` said they had moved. So the
 * branch is applied over the compose URL whenever the order picks Docker, by a
 * typed `--docker` or the remembered one, and the answer stays Docker: that is
 * what has the container started and what `rebase dev` records.
 *
 * What outranks a switch still does. `--database-url` and a `DATABASE_URL` in
 * the shell name a database outright, and the managed database cannot hold a
 * branch at all — that last one is reported as `ignoredBranch`, so the caller
 * can say so instead of quietly using main.
 *
 * `env` is the shell environment to judge against, `process.env` by default;
 * `rebase status` passes `{}`, because it asks what *this project* is on.
 */
export function resolveProjectDatabaseAndBranch(
    projectRoot: string,
    options: Pick<PrepareOptions, "flagUrl" | "flagDocker" | "followLastDev"> & {
        env?: Record<string, string | undefined>;
    } = {}
): ProjectDatabase {
    const envFile = readEnvFile(projectRoot);
    const active = readActiveBranch(projectRoot);

    const database = resolveDevDatabase({
        flagUrl: options.flagUrl,
        flagDocker: options.flagDocker,
        lastDevDocker: options.followLastDev !== false && readLastDevDocker(projectRoot),
        env: options.env ?? process.env,
        envFile,
        branch: resolveActiveBranch(projectRoot, envFile),
        composeUrl: resolveComposeUrl(projectRoot, envFile)
    });

    if (!active) return { database, branch: null, ignoredBranch: null };

    if (database.kind === "external" && database.source === "branch") {
        const parent = databaseNameOf(envFile.DATABASE_URL?.trim() ?? "");
        return { database, branch: { ...active, parent }, ignoredBranch: null };
    }

    if (database.kind === "docker" && database.url) {
        const url = branchUrl(database.url, active.database);
        if (url) {
            return {
                database: { ...database, url },
                branch: { ...active, parent: databaseNameOf(database.url) },
                ignoredBranch: null
            };
        }
    }

    return { database, branch: null, ignoredBranch: database.kind === "managed" ? active.name : null };
}

/**
 * The variable a driver child reads {@link devDatabaseKind} from.
 *
 * One name, exported, because three commands build that child's environment and
 * a fourth reads it in another package.
 */
export const DEV_DATABASE_KIND_ENV = "REBASE_DEV_DATABASE_KIND";

/**
 * The variable that tells a server started on a branch which database it was
 * branched from.
 *
 * The branch registry lives in that database, and a branch database holds
 * only a snapshot of it taken when it was copied — so a server on a branch
 * keeps its branches, and copies new ones from, the database named here. A
 * branch URL does not say which that is; only this checkout's `.env` does.
 */
export const BRANCH_PARENT_DATABASE_ENV = "REBASE_BRANCH_PARENT_DATABASE";

/**
 * Resolve, start if needed, and describe the database for this command.
 *
 * `projectRoot` is where the managed database's data lives, so two projects on
 * one machine get two databases without either being told about the other.
 */
export async function prepareDatabaseEnv(
    projectRoot: string,
    options: PrepareOptions = {}
): Promise<PreparedDatabase> {
    const envFile = readEnvFile(projectRoot);
    const { database, branch, ignoredBranch } = resolveProjectDatabaseAndBranch(projectRoot, options);

    // A branch on Docker is still Docker to the resolver, so its own line does
    // not name the branch; this does, because that is the database in use.
    const description = database.kind === "docker" && branch
        ? `branch "${branch.name}" (rebase db branch switch) on ${describeDevDatabase(database)}`
        : describeDevDatabase(database);
    // Where a branch lives, for the server: the registry is kept in the
    // database the branch was taken from, and a branch URL does not say which.
    const parentEnv: Record<string, string> = branch?.parent ? { [BRANCH_PARENT_DATABASE_ENV]: branch.parent } : {};

    // Said even on a quiet command: `rebase db url --docker` is quiet, and its
    // progress goes to stderr, which is where a flag it did not follow belongs.
    const outranked = outrankedDockerFlagNotice(database, options.flagDocker);
    if (outranked) options.onProgress?.(outranked);

    if (ignoredBranch) {
        options.onProgress?.(
            `Branch "${ignoredBranch}" is switched to, but this uses the managed database, which has no branches, `
            + "so the main database is used. `--docker` (or DATABASE_URL in .env) reaches the branch; "
            + "`rebase db branch switch --off` clears the switch."
        );
    }

    if (database.kind === "external" && (database.source === "branch" || database.source === "flag")) {
        // The two external cases that MUST be exported. `environment` and
        // `env-file` are already somewhere the child will look — the shell it
        // inherits, or `.env` via DOTENV_CONFIG_PATH — but a branch URL is
        // derived here and exists nowhere else, and `--database-url` lives only
        // in this process's argv. Without this the pointer resolves correctly
        // and then changes nothing: `rebase db backup` on a switched checkout
        // still reported `Database: leadgen`, and `rebase dev --database-url …`
        // announced the database and then died on `DATABASE_URL: is required`.
        //
        // Safe to set: `dotenv` does not overwrite a variable that is already
        // in the environment, so the child's own `.env` load cannot undo it.
        // On a branch, the database it was branched from too.
        return { database, env: { DATABASE_URL: database.url, ...parentEnv }, description };
    }

    if (database.kind === "docker") {
        // Docker is the one case where nothing has named a connection string:
        // `.env` leaves DATABASE_URL commented out, so without this the child
        // booted with no database at all and failed on the message a project
        // that configured nothing gets — while the container it had just been
        // asked for was never started either.
        if (!database.url) {
            throw new Refusal(
                "--docker needs a docker-compose.yml with a db service in this project, " +
                "and this one has none that names POSTGRES_USER, POSTGRES_DB and a published port. " +
                "Set DATABASE_URL in .env to point at the database you mean instead."
            );
        }
        // Said every time it decides, because nothing on this command line
        // asked for Docker: the reader should not have to remember that an
        // earlier `rebase dev` did.
        if (database.source === "last-dev") {
            options.onProgress?.(
                `Using ${branch ? `branch "${branch.name}" (${branch.database}) of ` : ""}Postgres in Docker, `
                + "as the last `rebase dev --docker` did. `rebase dev` without --docker goes back to the managed database."
            );
        }
        return { database, env: { DATABASE_URL: database.url, ...parentEnv }, description };
    }

    if (database.kind !== "managed") {
        // `environment` or `env-file`: the connection string is already in a
        // place the child reads for itself, so this adds nothing to it.
        return { database, env: {}, description };
    }

    // Only the keys nobody bound by hand. A developer who set
    // DATABASE_URL__ANALYTICS to a warehouse of their own has said which
    // database that is, and the managed one fills a vacuum, never a choice.
    const unbound = (options.additionalKeys ?? []).filter((key) => {
        const name = `DATABASE_URL${resourceEnvSuffix(key)}`;
        return !process.env[name] && !envFile[name];
    });

    const managed = await ensureManagedDatabase(projectRoot, {
        quiet: options.quiet,
        onProgress: options.onProgress,
        additionalKeys: unbound
    });

    const additionalEnv: Record<string, string> = {};
    for (const [key, url] of Object.entries(managed.additional)) {
        additionalEnv[`DATABASE_URL${resourceEnvSuffix(key)}`] = url;
    }

    return {
        database,
        description,
        dataDir: managed.dataDir,
        startedDaemon: managed.started,
        additional: managed.additional,
        env: {
            DATABASE_URL: managed.url,
            // PGlite is one session behind a multiplexer: two pooled clients in
            // overlapping transactions deadlock there. This is the ceiling that
            // turns that into ordinary queueing — see `constraints.ts`.
            REBASE_DB_POOL_MAX: String(MANAGED_POOL_MAX),
            ...additionalEnv
        }
    };
}

/**
 * The lines to print about a managed database, in the order to print them.
 *
 * Returned rather than printed so the caller decides where they go — `dev` has
 * a banner, `db push` has a single line above its own output — and so a test can
 * assert on them without capturing a stream.
 */
export function managedNotices(prepared: PreparedDatabase): string[] {
    if (prepared.database.kind !== "managed") return [];

    const lines = [`Using ${prepared.description}.`];
    if (prepared.dataDir) lines.push(`Data: ${prepared.dataDir}`);
    for (const key of Object.keys(prepared.additional ?? {})) {
        lines.push(`Also serving database "${key}" as DATABASE_URL${resourceEnvSuffix(key)}`);
    }

    // Stated every time rather than discovered. A developer who does not know
    // requests are serialized here will read a concurrency difference as a bug
    // in their own code.
    for (const limitation of MANAGED_LIMITATIONS) {
        lines.push(`${limitation.summary} ${limitation.remedy}`);
    }
    lines.push("To use your own Postgres instead, set DATABASE_URL in .env.");

    return lines;
}
