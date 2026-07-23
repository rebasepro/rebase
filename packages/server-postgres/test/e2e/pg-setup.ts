import { execa } from "execa";
import crypto from "crypto";
import pg from "pg";

export interface PgContainer {
    containerName: string;
    connectionString: string;
    port: number;
}

/**
 * Spins up a temporary PostgreSQL instance using a Docker container.
 * Publishes port 5432 to a random host port to prevent collisions.
 */
export async function startPgContainer(): Promise<PgContainer> {
    const containerName = `rebase-db-e2e-${crypto.randomUUID().slice(0, 8)}`;

    console.log(`[pg-setup] Starting PostgreSQL container: ${containerName}`);

    await execa("docker", [
        "run",
        "--name", containerName,
        "-e", "POSTGRES_DB=rebase",
        "-e", "POSTGRES_USER=rebase",
        "-e", "POSTGRES_PASSWORD=rebase",
        "-p", "5432",          // random host port
        "-d",
        "postgres:18-alpine"
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
    try {
        await execa("docker", ["rm", "-f", containerName]);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[pg-setup] Cleanup failed for ${containerName}: ${msg}`);
    }
}
