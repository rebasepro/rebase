/**
 * `rebase console` on the managed database while other clients hold
 * connections to it.
 *
 * Against a PGlite with two other clients attached — a running `rebase dev` —
 * it failed with `read ECONNRESET`, logged as one line holding the whole stack
 * as JSON. Two causes, measured apart here: the socket server leaked a slot to
 * every client that died mid-response, so "two attached" was really more
 * (fixed in `notification-proxy.ts`); and a database that has no slot left at
 * all refuses the next connection by resetting it, which said nothing about
 * why.
 *
 * Built as the daemon builds it (PGlite, the socket server with the same
 * limit, the notification proxy in front), with the driver's own CLI run from
 * source, as `rebase console` spawns it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { execa } from "execa";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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
        title: { name: "Title", type: "string" }
    }
};
`;

describe("rebase console against the managed database beside other clients", () => {
    let db: { close(): Promise<void> };
    let server: { stop(): Promise<void> };
    let proxy: NotificationProxy;
    let url: string;
    let project: string;
    const held: pg.Client[] = [];

    const hold = async (count: number): Promise<void> => {
        for (let i = 0; i < count; i++) {
            const client = new pg.Client({ connectionString: url });
            client.on("error", () => undefined);
            await client.connect();
            held.push(client);
        }
    };

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

        project = fs.mkdtempSync(path.join(os.tmpdir(), "managed-console-"));
        fs.mkdirSync(path.join(project, "backend"));
        fs.mkdirSync(path.join(project, "config", "collections"), { recursive: true });
        fs.writeFileSync(path.join(project, "backend", "package.json"), JSON.stringify({ name: "backend", type: "module" }));
        fs.writeFileSync(path.join(project, "config", "collections", "package.json"), JSON.stringify({ type: "module" }));
        fs.writeFileSync(path.join(project, "config", "collections", "tasks.js"), tasks);
        fs.writeFileSync(path.join(project, "config", "collections", "index.js"),
            "import tasks from \"./tasks.js\";\nexport default [tasks];\n");
        const setup = new pg.Client({ connectionString: url });
        await setup.connect();
        await setup.query("CREATE TABLE public.tasks (id uuid PRIMARY KEY, title varchar)");
        await setup.end();
    });

    afterEach(async () => {
        for (const client of held.splice(0)) await client.end().catch(() => undefined);
    });

    afterAll(async () => {
        await proxy?.stop();
        await server?.stop();
        await db?.close();
        if (project) fs.rmSync(project, { recursive: true, force: true });
    });

    /** `rebase console -e <code>` as the CLI spawns it on the managed database. */
    const consoleEval = (code: string) => execa(TSX, [DRIVER_CLI, "console", "--eval", code], {
        cwd: path.join(project, "backend"),
        reject: false,
        env: {
            DATABASE_URL: url,
            REBASE_DEV_DATABASE_KIND: "managed",
            // What the CLI hands every child on the managed database.
            REBASE_DB_POOL_MAX: "1",
            LOG_LEVEL: "info",
            // The code under test, not the last build.
            TSX_TSCONFIG_PATH: path.join(REPO, "tsconfig.typecheck.json")
        }
    });

    it("answers beside the two connections a running dev server holds", async () => {
        await hold(2);
        const result = await consoleEval("rebase.sql('SELECT count(*)::int AS n FROM public.tasks')");

        expect(result.stderr).not.toContain("ECONNRESET");
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual([{ n: 0 }]);
    });

    it("says the managed database has no free connection, in words, when every one is taken", async () => {
        await hold(MANAGED_SERVER_MAX_CONNECTIONS);
        const result = await consoleEval("rebase.sql('SELECT 1')");

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("no free connection");
        expect(result.stderr).toContain("rebase dev");
        // Not a serialised error: no stack, no JSON.
        expect(result.stderr).not.toMatch(/"stack"|\n\s+at /);
    });
});
