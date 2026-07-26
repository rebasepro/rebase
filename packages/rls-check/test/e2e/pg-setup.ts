/**
 * Temporary Postgres in Docker for the integration suite.
 *
 * Mirrors `packages/server-postgres/test/e2e/pg-setup.ts` — same image, same
 * random-host-port trick, same "gate on a real connection, not pg_isready"
 * readiness loop — with one difference: it shells out through `node:child_process`
 * instead of `execa`. This package's dependency list is a feature (`pg` and
 * nothing else, so `npx` is fast and auditable), and that discipline extends to
 * its dev dependencies.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import pg from "pg";

const run = promisify(execFile);

export interface PgContainer {
    containerName: string;
    connectionString: string;
    port: number;
}

/**
 * Whether Docker is usable right now. Callers skip rather than fail: a
 * contributor without Docker should still get a green `pnpm test`.
 */
export async function isDockerAvailable(): Promise<boolean> {
    try {
        await run("docker", ["info"], { timeout: 15_000 });

        return true;
    } catch {
        return false;
    }
}

export async function startPgContainer(): Promise<PgContainer> {
    const containerName = `rls-check-e2e-${randomUUID().slice(0, 8)}`;

    await run("docker", [
        "run",
        "--name", containerName,
        "-e", "POSTGRES_DB=rlscheck",
        "-e", "POSTGRES_USER=rlscheck",
        "-e", "POSTGRES_PASSWORD=rls-check-e2e-secret",
        "-p", "5432", // random host port
        "-d",
        "postgres:18-alpine"
    ]);

    const { stdout } = await run("docker", ["port", containerName, "5432"]);
    const portMatch = stdout.match(/:(\d+)\s*$/m);
    if (!portMatch) {
        await stopPgContainer(containerName);
        throw new Error(`Failed to parse the published host port from: ${stdout}`);
    }

    const port = Number.parseInt(portMatch[1], 10);
    const connectionString = `postgresql://rlscheck:rls-check-e2e-secret@localhost:${port}/rlscheck?sslmode=disable`;

    // The postgres image boots a throwaway server to run its init scripts and
    // then restarts for real, so `pg_isready` can pass against a server that is
    // about to disappear. Only an actual SELECT proves the right one is up.
    let ready = false;
    for (let attempt = 0; attempt < 90 && !ready; attempt += 1) {
        const client = new pg.Client({ connectionString, connectionTimeoutMillis: 2000 });
        try {
            await client.connect();
            await client.query("SELECT 1");
            ready = true;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 500));
        } finally {
            await client.end().catch(() => {});
        }
    }

    if (!ready) {
        await stopPgContainer(containerName);
        throw new Error("Postgres container failed to become ready in time");
    }

    return { containerName, connectionString, port };
}

export async function stopPgContainer(containerName: string): Promise<void> {
    try {
        await run("docker", ["rm", "-f", containerName]);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[pg-setup] Cleanup failed for ${containerName}: ${message}`);
    }
}

/** Run a read query and hand back the rows. For assertions about the catalog itself. */
export async function querySql<T extends Record<string, unknown>>(
    connectionString: string,
    sql: string
): Promise<T[]> {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
        const result = await client.query<T>(sql);

        return result.rows;
    } finally {
        await client.end();
    }
}

/** Apply a SQL script as one multi-statement query. */
export async function applySql(connectionString: string, sql: string): Promise<void> {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
        await client.query(sql);
    } finally {
        await client.end();
    }
}
