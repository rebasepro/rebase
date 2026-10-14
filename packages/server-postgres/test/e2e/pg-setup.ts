import { execa } from "execa";
import { spawnSync } from "node:child_process";
import crypto from "crypto";
import pg from "pg";
import { detectToolMajor, resolvePgBinary } from "../../src/backup/backup-service.js";

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
 * `-v` on every `docker rm`: `--rm` would drop the image's anonymous data
 * volume, but a `docker rm` without `-v` keeps it — 577 of them (34 GB) had
 * piled up on one machine.
 */
function installCleanup(): void {
    if (cleanupInstalled) return;
    cleanupInstalled = true;

    const reap = () => {
        for (const name of running) {
            spawnSync("docker", ["rm", "-f", "-v", name], { stdio: "ignore" });
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

/** The major {@link DEFAULT_PG_IMAGE} runs. A newer client is fine against it. */
const DEFAULT_IMAGE_MAJOR = 18;

/**
 * The image for a suite that runs `pg_dump` / `pg_restore` against it.
 *
 * `pg_dump` must be at least as new as the server it reads, and CI's runner
 * ships an older client than {@link DEFAULT_PG_IMAGE}, so the server's major
 * follows the client's rather than the other way round. A missing client
 * fails the suite instead of skipping it, because a skipped suite would report
 * a pass.
 */
export async function imageForLocalClient(): Promise<string> {
    const bin = resolvePgBinary("pg_dump");
    const major = bin ? await detectToolMajor(bin) : null;
    if (!bin || major === null) {
        throw new Error(
            "pg_dump was not found (or its version could not be read), so this suite cannot take a backup. " +
            "Install the PostgreSQL client tools, or set PG_DUMP_PATH, PG_DUMPALL_PATH and PG_RESTORE_PATH."
        );
    }
    return major >= DEFAULT_IMAGE_MAJOR ? DEFAULT_PG_IMAGE : `postgres:${major}-alpine`;
}

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
    // `REBASE_E2E_CONTAINER_PREFIX` lets several runs on one machine tell their
    // containers apart, so one run's cleanup never reaches another's.
    const prefix = process.env.REBASE_E2E_CONTAINER_PREFIX || "rebase-db-e2e-";
    const containerName = `${prefix}${crypto.randomUUID().slice(0, 8)}`;

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
    // The `PgContainer` this file hands out is one property away from the name,
    // and two suites passed the whole object. `execa` then reported
    // `Second argument must be an array of strings: rm,-f,[object Object]`,
    // which the catch below turned into one grey line while the container stayed
    // up for the rest of the run — a leaked Postgres per suite, and a port with
    // it. `test/` is outside the typecheck (see tsconfig), so this is the only
    // place the mistake can be caught; loud, because a swallowed cleanup failure
    // is what hid it.
    if (typeof containerName !== "string") {
        throw new TypeError(
            "stopPgContainer takes a container NAME, not the PgContainer object — "
            + "pass `container.containerName`."
        );
    }
    console.log(`[pg-setup] Removing container: ${containerName}`);
    running.delete(containerName);
    try {
        await execa("docker", ["rm", "-f", "-v", containerName]);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[pg-setup] Cleanup failed for ${containerName}: ${msg}`);
    }
}
