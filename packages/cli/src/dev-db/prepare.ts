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

import { readEnvFile } from "../utils/project";
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
    const database = resolveDevDatabase({
        flagUrl: options.flagUrl,
        flagDocker: options.flagDocker,
        env: process.env,
        envFile: readEnvFile(projectRoot)
    });

    const description = describeDevDatabase(database);

    if (database.kind !== "managed") {
        // An explicit connection string, or Docker. Either way the child's
        // environment is already correct and this adds nothing to it.
        return { database, env: {}, description };
    }

    const managed = await ensureManagedDatabase(projectRoot, {
        quiet: options.quiet,
        onProgress: options.onProgress
    });

    return {
        database,
        description,
        dataDir: managed.dataDir,
        startedDaemon: managed.started,
        env: {
            DATABASE_URL: managed.url,
            // PGlite is one session behind a multiplexer: two pooled clients in
            // overlapping transactions deadlock there. This is the ceiling that
            // turns that into ordinary queueing — see `constraints.ts`.
            REBASE_DB_POOL_MAX: String(MANAGED_POOL_MAX)
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

    // Stated every time rather than discovered. A developer who does not know
    // requests are serialized here will read a concurrency difference as a bug
    // in their own code.
    for (const limitation of MANAGED_LIMITATIONS) {
        lines.push(`${limitation.summary} ${limitation.remedy}`);
    }
    lines.push("To use your own Postgres instead, set DATABASE_URL in .env.");

    return lines;
}
