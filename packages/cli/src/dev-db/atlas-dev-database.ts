/**
 * A second, throwaway PGlite for Atlas to plan against.
 *
 * Atlas computes a schema change by replaying the desired schema into an
 * **empty** database and diffing. On a real server the driver makes one as
 * `<db>_dev_diff`; PGlite serves exactly one database, so that `CREATE
 * DATABASE` succeeds and creates nothing, and `rebase db push`, `generate` and
 * `migrate` were refused on the managed database outright — which left it with
 * no way to drop, rename or narrow a column: boot only ever adds.
 *
 * So the command that needs one starts one: in memory, in this process, for
 * as long as the command runs. It shares nothing with the managed database's
 * daemon (a separate instance, no data directory, a port of its own), so the
 * project's data is never the thing Atlas fills and clears, and nothing is
 * left behind — not a directory, not a process.
 *
 * Measured with Atlas 1.2.3 against PGlite 0.5.6: `schema apply` with this as
 * `--dev-url` plans and applies a DROP COLUMN and a `varchar(200)` →
 * `varchar(50)` narrowing on a PGlite target, and the dev database is empty
 * again afterwards, so one instance serves every Atlas call of a command.
 *
 * It runs on this process's event loop. The driver runs as a child process,
 * which is what keeps the loop free to serve it; a synchronous wait on that
 * child would hang Atlas.
 */

import { loadExtensions } from "./daemon-entry";
import { MANAGED_SERVER_MAX_CONNECTIONS } from "./constraints";
import { managedUrl } from "./daemon";
import { findFreePort } from "./state";

export interface AtlasDevDatabase {
    /** Connection string for Atlas's `--dev-url`. */
    url: string;
    /** Stop serving and drop the instance. Safe to call twice. */
    stop(): Promise<void>;
}

export async function startAtlasDevDatabase(): Promise<AtlasDevDatabase> {
    const { PGlite } = (await import("@electric-sql/pglite")) as {
        PGlite: { create(options: unknown): Promise<unknown> };
    };
    const { PGLiteSocketServer } = (await import("@electric-sql/pglite-socket")) as {
        PGLiteSocketServer: new (options: unknown) => { start(): Promise<void>; stop(): Promise<void> };
    };

    // The same extension bundles as the managed database: a schema that
    // creates `pg_trgm` or `vector` must replay here exactly as it applies
    // there, or Atlas fails on the replay rather than the apply.
    const extensions = await loadExtensions();
    // No `dataDir`: in memory, gone with the process.
    const db = (await PGlite.create({ extensions })) as { close(): Promise<void> };
    const port = await findFreePort();
    const server = new PGLiteSocketServer({
        db,
        port,
        host: "127.0.0.1",
        maxConnections: MANAGED_SERVER_MAX_CONNECTIONS
    });
    try {
        await server.start();
    } catch (err) {
        await db.close().catch(() => undefined);
        throw err;
    }

    let stopped = false;
    return {
        url: managedUrl(port),
        async stop() {
            if (stopped) return;
            stopped = true;
            await server.stop().catch(() => undefined);
            await db.close().catch(() => undefined);
        }
    };
}
