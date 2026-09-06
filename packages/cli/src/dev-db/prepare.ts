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
import { readEnvFile } from "../utils/project";
import { resourceEnvSuffix } from "@rebasepro/types";
import { branchUrl, readActiveBranch } from "./branch-pointer";
import { MANAGED_LIMITATIONS, MANAGED_POOL_MAX } from "./constraints";
import { ensureManagedDatabase } from "./daemon";
import { type DevDatabase, describeDevDatabase, resolveDevDatabase } from "./resolve";

export interface PrepareOptions {
    /** `--database-url <url>`. */
    flagUrl?: string | null;
    /** `--docker`. */
    flagDocker?: boolean;
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
 * The branch this checkout is switched to, as a connection string.
 *
 * Derived rather than stored: the pointer holds a name, and the credentials
 * stay in the one place the developer wrote them. The base is the project's
 * `.env` — a switch is a statement about *this project's* database, so a
 * `DATABASE_URL` that happens to be in the shell is not the thing being
 * branched, and it outranks the branch anyway.
 *
 * Returns null when there is no branch, and also when there is no base to swap
 * the database name on: a project with no `DATABASE_URL` is on the managed
 * database, where branching does not work at all.
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
 * exported so `rebase dev` can hand the same URL to the preflight that starts
 * the container — the preflight decides "local, and not running" from a DSN,
 * so without one `--docker` asked for a container nothing ever started.
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
    const database = resolveDevDatabase({
        flagUrl: options.flagUrl,
        flagDocker: options.flagDocker,
        env: process.env,
        envFile,
        branch: resolveActiveBranch(projectRoot, envFile),
        composeUrl: resolveComposeUrl(projectRoot, envFile)
    });

    const description = describeDevDatabase(database);

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
        return { database, env: { DATABASE_URL: database.url }, description };
    }

    if (database.kind === "docker") {
        // Docker is the one case where nothing has named a connection string:
        // `.env` leaves DATABASE_URL commented out, so without this the child
        // booted with no database at all and failed on the message a project
        // that configured nothing gets — while the container it had just been
        // asked for was never started either.
        if (!database.url) {
            throw new Error(
                "--docker needs a docker-compose.yml with a db service in this project, " +
                "and this one has none that names POSTGRES_USER, POSTGRES_DB and a published port. " +
                "Set DATABASE_URL in .env to point at the database you mean instead."
            );
        }
        return { database, env: { DATABASE_URL: database.url }, description };
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
