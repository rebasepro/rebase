import { execa } from "execa";
import crypto from "crypto";

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

    // Poll pg_isready
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
        try {
            await execa("docker", [
                "exec", containerName,
                "pg_isready", "-U", "rebase", "-d", "rebase"
            ]);
            console.log("[pg-setup] PostgreSQL is ready.");
            break;
        } catch {
            attempts++;
            await new Promise(r => setTimeout(r, 500));
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
