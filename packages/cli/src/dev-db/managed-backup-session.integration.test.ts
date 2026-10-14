/**
 * `rebase db backup` on the managed database while `rebase dev` runs.
 *
 * The managed database is one PGlite session every connection shares, so what
 * `pg_dump` sets for itself stayed set for everyone after it: `search_path`
 * empty and `row_security` off. After one backup every API request answered
 * 500 "table does not exist", restarting `rebase dev` did not help (the
 * database outlives it), and a second backup failed on `prepared statement
 * "dumpenumtype" already exists`. Only `rebase db stop` recovered.
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

import { resetSharedSession } from "@rebasepro/server-postgres";

import { MANAGED_SERVER_MAX_CONNECTIONS } from "./constraints";
import { managedUrl } from "./daemon";
import { NotificationProxy } from "./notification-proxy";
import { findPgTool } from "./pull";
import { findFreePort } from "./state";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const DRIVER_CLI = path.join(REPO, "packages", "server-postgres", "src", "cli.ts");
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");

/** The managed database is Postgres 18; an older `pg_dump` is refused before it connects. */
const MANAGED_MAJOR = 18;

describe("db backup against the managed database while a dev server holds connections", () => {
    let db: { close(): Promise<void> };
    let server: { stop(): Promise<void> };
    let proxy: NotificationProxy;
    let url: string;
    let project: string;
    let dumpMajor: number;
    /** The session as the dev server had it before any tool ran. */
    let before: { search_path: string; row_security: string; posts: number };
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
        await held[0].query("CREATE TABLE public.posts (id serial PRIMARY KEY, title text NOT NULL); INSERT INTO public.posts (title) VALUES ('one')");
        before = await devSession();
        expect(before.search_path).not.toBe("");
        expect(before.row_security).toBe("on");

        const version = await findPgTool("pg_dump");
        dumpMajor = Number(/(\d+)(\.\d+)*\s*(\(|$)/.exec(version ?? "")?.[1] ?? Number.NaN);
        if (!Number.isInteger(dumpMajor)) {
            throw new Error("pg_dump is needed on PATH for this suite (e.g. `brew install libpq`).");
        }

        project = fs.mkdtempSync(path.join(os.tmpdir(), "managed-backup-"));
        fs.mkdirSync(path.join(project, "backend"));
        fs.writeFileSync(path.join(project, "backend", "package.json"), JSON.stringify({ name: "backend", type: "module" }));
    });

    afterAll(async () => {
        for (const client of held) await client.end().catch(() => undefined);
        await proxy?.stop();
        await server?.stop();
        await db?.close();
        if (project) fs.rmSync(project, { recursive: true, force: true });
    });

    const driver = (...args: string[]) => execa(TSX, [DRIVER_CLI, ...args], {
        cwd: path.join(project, "backend"),
        reject: false,
        all: true,
        env: {
            DATABASE_URL: url,
            REBASE_DEV_DATABASE_KIND: "managed",
            // The code under test, not the last build.
            TSX_TSCONFIG_PATH: path.join(REPO, "tsconfig.typecheck.json")
        }
    });

    /** What the dev server's next query runs under, and that it still finds its table. */
    const devSession = async () => {
        const { rows } = await held[0].query<{ search_path: string; row_security: string }>(
            "SELECT current_setting('search_path') AS search_path, current_setting('row_security') AS row_security"
        );
        const posts = await held[0].query<{ n: string }>("SELECT count(*) AS n FROM posts");
        return { ...rows[0], posts: Number(posts.rows[0].n) };
    };

    it("puts back what a client tool left set on the shared session: settings and prepared statements", async () => {
        // What pg_dump's session setup does, on a connection of its own.
        await held[1].query("SELECT pg_catalog.set_config('search_path', '', false)");
        await held[1].query("SET row_security = off");
        await held[1].query("PREPARE dumpenumtype(pg_catalog.oid) AS SELECT $1");
        await expect(held[0].query("SELECT count(*) FROM posts")).rejects.toThrow(/does not exist/);

        await resetSharedSession(url);

        expect(await devSession()).toEqual(before);
        // Deallocated: pg_dump's next run prepares it again.
        await held[1].query("PREPARE dumpenumtype(pg_catalog.oid) AS SELECT $1");
        await resetSharedSession(url);
    });

    it("leaves the dev server's session as it found it after two backups in a row", async () => {
        const out = path.join(project, "backups");
        if (dumpMajor < MANAGED_MAJOR) {
            // This pg_dump cannot read the managed database at all, and says so
            // before it connects: the session is not touched.
            const refused = await driver("db", "backup", "--out", out);
            expect(refused.exitCode).toBe(1);
            expect(refused.all).toContain(`Client tool is Postgres ${dumpMajor} but the server is Postgres ${MANAGED_MAJOR}`);
            expect(await devSession()).toEqual(before);
            return;
        }
        for (const run of [1, 2]) {
            const backup = await driver("db", "backup", "--out", out);
            expect(backup.all, `backup ${run}`).not.toContain("already exists");
            expect(backup.exitCode, backup.all).toBe(0);
            expect(await devSession(), `after backup ${run}`).toEqual(before);
        }
        expect(fs.readdirSync(out).some(name => name.endsWith(".dump"))).toBe(true);
    });
});
