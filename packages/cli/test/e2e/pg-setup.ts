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
 * outlives the process that started it and keeps its port and memory. Two
 * `rebase-test-postgres-*` containers were found still up ten hours after the
 * run that made them.
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
 * Checks for readiness using `pg_isready`.
 */
export async function startPgContainer(): Promise<PgContainer> {
    const containerName = `rebase-test-postgres-${crypto.randomUUID()}`;

    console.log(`Starting PostgreSQL container: ${containerName}...`);

    installCleanup();
    running.add(containerName);

    // Run container with custom user, db, password and map 5432 to a random host port
    await execa("docker", [
        "run",
        "--rm", // self-remove once it stops
        "--name",
        containerName,
        "-e",
        "POSTGRES_DB=rebase",
        "-e",
        "POSTGRES_USER=rebase",
        "-e",
        "POSTGRES_PASSWORD=rebase",
        "-p",
        "5432",
        "-d",
        "postgres:18-alpine"
    ]);

    // Find the randomly assigned port on the host
    const { stdout: portOutput } = await execa("docker", ["port", containerName, "5432"]);
    const portMatch = portOutput.match(/:(\d+)$/m);
    if (!portMatch) {
        // Cleanup if we fail to get the port
        await stopPgContainer(containerName);
        throw new Error(`Failed to parse host port from docker port output: ${portOutput}`);
    }
    const port = parseInt(portMatch[1], 10);
    // sslmode=disable: the container has no TLS and atlas (rebase db push)
    // defaults to requiring SSL when the URL doesn't say otherwise.
    const connectionString = `postgresql://rebase:rebase@localhost:${port}/rebase?options=-c%20search_path=public&sslmode=disable`;

    console.log(`Container started on port ${port}. Waiting for database readiness...`);

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
            console.log("PostgreSQL database is ready.");
            break;
        } catch (e) {
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 500));
        } finally {
            await client.end().catch(() => {});
        }
    }

    if (attempts === maxAttempts) {
        await stopPgContainer(containerName);
        throw new Error("Postgres container failed to become ready in time");
    }

    return {
        containerName,
        connectionString,
        port
    };
}

/**
 * Shuts down and deletes a PostgreSQL container instance.
 */
export async function stopPgContainer(containerName: string): Promise<void> {
    console.log(`Stopping and removing PostgreSQL container: ${containerName}...`);
    running.delete(containerName);
    try {
        await execa("docker", ["rm", "-f", containerName]);
        console.log("Container removed successfully.");
    } catch (e: any) {
        console.error(`Failed to clean up container ${containerName}:`, e.message || e);
    }
}
