import { execa } from "execa";
import { spawnSync } from "node:child_process";
import crypto from "crypto";
import pg from "pg";

export interface PgContainer {
    containerName: string;
    connectionString: string;
    port: number;
}

/**
 * Containers this process started and has not yet removed.
 *
 * Teardown lives in an `afterAll`, which does not run when the runner is killed
 * — Ctrl-C, a cancelled CI job, an OOM. The container is detached, so it
 * outlives the process that started it and keeps its port and memory. Two were
 * found still up ten hours after the run that made them.
 */
const running = new Set<string>();
let cleanupInstalled = false;

/**
 * Force-removes anything still running when the process goes down.
 *
 * `spawnSync`, because an `exit` handler cannot await. `--rm` on `docker run`
 * covers only the case where postgres itself exits; a killed *test runner*
 * leaves the container up and healthy, which is the case that actually leaked.
 */
function installCleanup(): void {
    if (cleanupInstalled) return;
    cleanupInstalled = true;

    const reap = () => {
        for (const name of running) {
            spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
        }
        running.clear();
    };

    process.once("exit", reap);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.once(signal, () => {
            reap();
            // Re-raise with the default disposition so the exit status still
            // reads as "killed by signal" to whatever is supervising.
            process.kill(process.pid, signal);
        });
    }
}

/**
 * Spins up a temporary PostgreSQL instance using a Docker container.
 * Publishes port 5432 to a random host port to prevent collisions.
 */
/**
 * The image every e2e suite gets.
 *
 * Alpine, and deliberately: its default collation is not Debian's, and several
 * suites assert on text ordering. `offline-query-agreement` exists to prove the
 * offline evaluator and Postgres DISAGREE about string comparison, and
 * `introspect-live` compares committed fixtures against a live catalogue. Both
 * went green-but-wrong the moment this was pointed at a Debian-based image —
 * the divergence they assert simply stopped happening.
 *
 * So the image is a per-caller decision, not a global one. See
 * {@link PGVECTOR_IMAGE}.
 */
export const DEFAULT_PG_IMAGE = "postgres:18-alpine";

/**
 * The same major with pgvector built in, for callers that need `vector`.
 *
 * `record-project-snapshot.mts` is the one today: the reference fixture declares
 * a vector property, and the framework deliberately withholds
 * `CREATE EXTENSION` from generated DDL. Do not make this the default — see
 * above.
 */
export const PGVECTOR_IMAGE = "pgvector/pgvector:pg18";

export async function startPgContainer(
    options: { image?: string } = {}
): Promise<PgContainer> {
    const image = options.image ?? DEFAULT_PG_IMAGE;
    const containerName = `rebase-db-e2e-${crypto.randomUUID().slice(0, 8)}`;

    console.log(`[pg-setup] Starting PostgreSQL container: ${containerName}`);

    installCleanup();
    running.add(containerName);

    await execa("docker", [
        "run",
        "--rm",                // self-remove once it stops
        "--name", containerName,
        "-e", "POSTGRES_DB=rebase",
        "-e", "POSTGRES_USER=rebase",
        "-e", "POSTGRES_PASSWORD=rebase",
        "-p", "5432",          // random host port
        "-d",
        image
    ]);

    // Discover the assigned host port
    const { stdout: portOutput } = await execa("docker", ["port", containerName, "5432"]);
    const portMatch = portOutput.match(/:(\d+)$/m);
    if (!portMatch) {
        await stopPgContainer(containerName);
        throw new Error(`Failed to parse host port from: ${portOutput}`);
    }
    const port = parseInt(portMatch[1], 10);
    const connectionString =
        `postgresql://rebase:rebase@localhost:${port}/rebase?sslmode=disable`;

    console.log(`[pg-setup] Container started on port ${port}. Waiting for readiness…`);

    // Gate on a real host connection, not just `pg_isready`. The postgres image
    // boots a temporary server to run its init scripts, then restarts for real;
    // `pg_isready` can pass against that transient server, so a client that
    // connects in the gap gets "Connection terminated unexpectedly". Opening an
    // actual libpq connection and running `SELECT 1` — retrying through the
    // restart — is the only check that proves the server clients will use is up.
    let attempts = 0;
    const maxAttempts = 60;
    while (attempts < maxAttempts) {
        const client = new pg.Client({ connectionString, connectionTimeoutMillis: 2000 });
        try {
            await client.connect();
            await client.query("SELECT 1");
            console.log("[pg-setup] PostgreSQL is ready.");
            break;
        } catch {
            attempts++;
            await new Promise(r => setTimeout(r, 500));
        } finally {
            await client.end().catch(() => {});
        }
    }

    if (attempts === maxAttempts) {
        await stopPgContainer(containerName);
        throw new Error("Postgres container failed to become ready in time");
    }

    return { containerName, connectionString, port };
}

/**
 * Stops and removes a PostgreSQL container.
 */
export async function stopPgContainer(containerName: string): Promise<void> {
    console.log(`[pg-setup] Removing container: ${containerName}`);
    running.delete(containerName);
    try {
        await execa("docker", ["rm", "-f", containerName]);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[pg-setup] Cleanup failed for ${containerName}: ${msg}`);
    }
}
