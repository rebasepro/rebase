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
 * Checks for readiness using `pg_isready`.
 */
export async function startPgContainer(): Promise<PgContainer> {
    const containerName = `rebase-test-postgres-${crypto.randomUUID()}`;

    console.log(`Starting PostgreSQL container: ${containerName}...`);

    // Run container with custom user, db, password and map 5432 to a random host port
    await execa("docker", [
        "run",
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
    const connectionString = `postgresql://rebase:rebase@localhost:${port}/rebase?options=-c%20search_path=public`;

    console.log(`Container started on port ${port}. Waiting for database readiness...`);

    // Wait until pg_isready succeeds
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
        try {
            await execa("docker", ["exec", containerName, "pg_isready", "-U", "rebase", "-d", "rebase"]);
            console.log("PostgreSQL database is ready.");
            break;
        } catch (e) {
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 500));
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
    try {
        await execa("docker", ["rm", "-f", containerName]);
        console.log("Container removed successfully.");
    } catch (e: any) {
        console.error(`Failed to clean up container ${containerName}:`, e.message || e);
    }
}
