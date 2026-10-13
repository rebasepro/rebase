/**
 * `rebase db push` on the managed database while `rebase dev` runs.
 *
 * The first push after `dev` started failed with a bare `Error: EOF` and
 * `✗ atlas schema apply … --dry-run failed`; the next ones passed. The managed
 * database is one PGlite session behind a socket server that accepts
 * {@link MANAGED_SERVER_MAX_CONNECTIONS} connections. A dev server holds some
 * (its pool's connection while warm, a LISTEN connection), the driver kept its
 * own open between steps, and `atlas schema apply` opens two, so Atlas's second
 * was over the limit and closed unanswered. The driver now lets its connection
 * go while Atlas runs.
 *
 * Built here as the daemon builds it (PGlite, the socket server with the same
 * limit, the notification proxy in front), with two connections held for the
 * dev server, and the driver's own CLI run from source.
 */
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAtlasDevDatabase, type AtlasDevDatabase } from "./atlas-dev-database";
import { MANAGED_SERVER_MAX_CONNECTIONS } from "./constraints";
import { managedUrl } from "./daemon";
import { NotificationProxy } from "./notification-proxy";
import { findFreePort } from "./state";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const DRIVER_CLI = path.join(REPO, "packages", "server-postgres", "src", "cli.ts");
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");

const tasks = `
export default {
    name: "Tasks", singularName: "Task", slug: "tasks", table: "tasks",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid", validation: { required: true } },
        title: { name: "Title", type: "string", validation: { required: true } }
    }
};
`;

describe("db push against the managed database while a dev server holds connections", () => {
    let db: { close(): Promise<void> };
    let server: { stop(): Promise<void> };
    let proxy: NotificationProxy;
    let dev: AtlasDevDatabase;
    let url: string;
    let project: string;
    const held: pg.Client[] = [];

    beforeAll(async () => {
        const { PGlite } = (await import("@electric-sql/pglite")) as {
            PGlite: { create(options?: unknown): Promise<{ close(): Promise<void> }> };
        };
        const { PGLiteSocketServer } = (await import("@electric-sql/pglite-socket")) as {
            PGLiteSocketServer: new (options: unknown) => { start(): Promise<void>; stop(): Promise<void> };
        };
        db = await PGlite.create();
        const upstreamPort = await findFreePort();
        const socketServer = new PGLiteSocketServer({
            db, port: upstreamPort, host: "127.0.0.1", maxConnections: MANAGED_SERVER_MAX_CONNECTIONS
        });
        await socketServer.start();
        server = socketServer;
        const listenPort = await findFreePort();
        proxy = new NotificationProxy({ listenPort, upstreamPort });
        await proxy.start();
        url = managedUrl(listenPort);

        // A running `rebase dev`: its pool's connection and a LISTEN one.
        for (let i = 0; i < 2; i++) {
            const client = new pg.Client({ connectionString: url });
            await client.connect();
            held.push(client);
        }

        dev = await startAtlasDevDatabase();

        project = fs.mkdtempSync(path.join(os.tmpdir(), "managed-push-"));
        fs.mkdirSync(path.join(project, "backend"));
        fs.mkdirSync(path.join(project, "config", "collections"), { recursive: true });
        fs.writeFileSync(path.join(project, "backend", "package.json"), JSON.stringify({ name: "backend", type: "module" }));
        fs.writeFileSync(path.join(project, "config", "collections", "package.json"), JSON.stringify({ type: "module" }));
        fs.writeFileSync(path.join(project, "config", "collections", "tasks.js"), tasks);
        fs.writeFileSync(path.join(project, "config", "collections", "index.js"),
            "import tasks from \"./tasks.js\";\nexport default [tasks];\n");
    });

    afterAll(async () => {
        for (const client of held) await client.end().catch(() => undefined);
        await dev?.stop();
        await proxy?.stop();
        await server?.stop();
        await db?.close();
        if (project) fs.rmSync(project, { recursive: true, force: true });
    });

    it("plans the push instead of failing on `Error: EOF`", async () => {
        const result = await execa(TSX, [
            DRIVER_CLI, "db", "push", "--dry-run", "--collections", path.join(project, "config", "collections")
        ], {
            cwd: path.join(project, "backend"),
            reject: false,
            all: true,
            env: {
                DATABASE_URL: url,
                REBASE_DEV_DATABASE_KIND: "managed",
                REBASE_ATLAS_DEV_URL: dev.url,
                // The code under test, not the last build.
                TSX_TSCONFIG_PATH: path.join(REPO, "tsconfig.typecheck.json")
            }
        });

        expect(result.all).not.toContain("Error: EOF");
        expect(result.all).toContain("Planned changes");
        expect(result.exitCode).toBe(0);
    });
});
