/**
 * What one write costs the realtime subscribers of one table, measured on a
 * throwaway Postgres in Docker.
 *
 *     TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx tooling/scripts/bench-realtime-fanout.mts
 *     TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx tooling/scripts/bench-realtime-fanout.mts --subscribers 10,100,1000,5000
 *     TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx tooling/scripts/bench-realtime-fanout.mts --root /path/to/another/checkout
 *
 * `--root` runs the same scenarios against another checkout's
 * `packages/server-postgres/src` (its node_modules must be installed or
 * linked — see `link-worktree-modules.sh`), which is how a before/after is
 * taken: a worktree at the base commit, and this one.
 *
 * Every scenario is N subscribers on one table, `notes`, whose RLS policy
 * shows each user only their own rows (`owner = app.uid`). Subscribers are
 * in-process sockets on the real `RealtimeService`, so what is measured is the
 * server's own cost — no network, no client. One write is made per run, and
 * for it the script reports:
 *
 * - **refetch tx**: transactions the realtime service opened to answer it —
 *   each one RLS-scoped read (and, for a list, its count);
 * - **queries**: every statement on the realtime pool for it (BEGIN,
 *   set_config, the read, the count, COMMIT);
 * - **first ms**: write committed → the first subscriber that may see the
 *   row has a frame carrying it;
 * - **all ms**: write committed → every subscriber that may see it has one;
 * - **settled ms**: write committed → the realtime pool is quiet again (the
 *   whole fan-out, including the reads that found nothing new).
 *
 * The realtime pool has 20 connections, so at most 5 refetches run at once
 * (`refetchConcurrencyFor`), and a refetch waits out a 300 ms debounce first:
 * that is the floor every latency here sits on.
 *
 * Scenarios:
 *
 * - `own-rows/api`: N users, each `listen({ where: owner == me })`; Alice
 *   writes one of her rows through the API.
 * - `own-rows/sql`: the same lists; the row is inserted with raw SQL and
 *   reaches realtime from the WAL (`REALTIME_CDC=wal`).
 * - `shared-list`: N users with the same unfiltered list — RLS alone narrows
 *   it. Each user is a different principal, so each is one read: what this
 *   costs is what policies that read the user cost.
 * - `tabs`: N sockets of one user on one list — one principal, one read.
 */

import { createRequire } from "module";
import path from "path";
import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { pathToFileURL, fileURLToPath } from "url";

type Args = { root: string; subscribers: number[]; image: string; keep: boolean };

function parseArgs(argv: string[]): Args {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const args: Args = {
        root: path.resolve(here, "../.."),
        subscribers: [10, 100, 1000, 5000],
        image: "postgres:18-alpine",
        keep: false
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (flag === "--root" && value) { args.root = path.resolve(value); i++; }
        else if (flag === "--subscribers" && value) { args.subscribers = value.split(",").map(Number); i++; }
        else if (flag === "--image" && value) { args.image = value; i++; }
        else if (flag === "--keep") args.keep = true;
        else throw new Error(`unknown argument ${flag}`);
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));
const pkg = path.join(args.root, "packages/server-postgres");
// pg and drizzle from the package under test, so `instanceof Pool` and every
// other identity check inside it sees the same module instances.
const requireFromPkg = createRequire(path.join(pkg, "package.json"));
const pg = (await import(pathToFileURL(requireFromPkg.resolve("pg")).href)).default as typeof import("pg");
const { drizzle } = await import(pathToFileURL(requireFromPkg.resolve("drizzle-orm/node-postgres")).href) as typeof import("drizzle-orm/node-postgres");
const { pgTable, varchar } = await import(pathToFileURL(requireFromPkg.resolve("drizzle-orm/pg-core")).href) as typeof import("drizzle-orm/pg-core");

const src = (rel: string) => pathToFileURL(path.join(pkg, rel)).href;
const { RealtimeService } = await import(src("src/services/realtimeService.ts")) as typeof import("../../packages/server-postgres/src/services/realtimeService");
const { PostgresBackendDriver } = await import(src("src/PostgresBackendDriver.ts")) as typeof import("../../packages/server-postgres/src/PostgresBackendDriver");
const { FixtureTableRegistry } = await import(src("test/helpers/tables.ts")) as typeof import("../../packages/server-postgres/test/helpers/tables");
const { ensureAppRole, REBASE_USER_ROLE } = await import(src("src/security/rls-enforcement.ts")) as typeof import("../../packages/server-postgres/src/security/rls-enforcement");
const { provisionWalPublication } = await import(src("src/services/cdc/wal-cdc.ts")) as typeof import("../../packages/server-postgres/src/services/cdc/wal-cdc");

// ── Postgres ─────────────────────────────────────────────────────────────

function startPostgres(): { name: string; url: string } {
    const name = `rebase-bench-fanout-${randomUUID().slice(0, 8)}`;
    const password = randomUUID();
    const run = spawnSync("docker", [
        "run", "-d", "--rm", "--name", name, "-e", `POSTGRES_PASSWORD=${password}`, "-p", "127.0.0.1::5432",
        args.image, "-c", "wal_level=logical", "-c", "max_connections=200"
    ], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
    const port = spawnSync("docker", ["port", name, "5432/tcp"], { encoding: "utf8" }).stdout.trim().split(":").pop();
    return { name, url: `postgres://postgres:${password}@127.0.0.1:${port}/postgres` };
}

async function connectWithRetry(url: string) {
    for (let i = 0; ; i++) {
        const client = new pg.Client({ connectionString: url });
        try {
            await client.connect();
            await client.query("SELECT 1");
            return client;
        } catch (error) {
            await client.end().catch(() => undefined);
            if (i > 60) throw error;
            await new Promise((r) => setTimeout(r, 500));
        }
    }
}

// ── Harness ──────────────────────────────────────────────────────────────

class CollectingSocket {
    readyState = 1;
    bufferedAmount = 0;
    sawAt: number | undefined;
    marker = "";
    send(msg: string) {
        if (this.sawAt === undefined && this.marker && msg.includes(this.marker)) this.sawAt = performance.now();
    }
    on() { /* not needed */ }
    close() { this.readyState = 3; }
    terminate() { this.readyState = 3; }
}

type Counters = { queries: number; refetchTx: number; lastAt: number };

const notesTable = pgTable("notes", { id: varchar("id").primaryKey(), owner: varchar("owner"), body: varchar("body") });
const notesCollection = {
    name: "Notes", slug: "notes", table: "notes",
    properties: { id: { type: "string" as const, isId: true }, owner: { type: "string" as const }, body: { type: "string" as const } }
};

async function waitUntil(fn: () => boolean, timeoutMs: number) {
    const deadline = performance.now() + timeoutMs;
    while (!fn()) {
        if (performance.now() > deadline) return false;
        await new Promise((r) => setTimeout(r, 5));
    }
    return true;
}

type Scenario = "own-rows/api" | "own-rows/sql" | "shared-list" | "tabs";

type Result = { scenario: Scenario; n: number; refetchTx: number; queries: number; firstMs: number; allMs: number; settledMs: number };

async function runScenario(url: string, admin: InstanceType<typeof pg.Client>, scenario: Scenario, n: number): Promise<Result> {
    await admin.query("TRUNCATE public.notes");
    const counters: Counters = { queries: 0, refetchTx: 0, lastAt: performance.now() };
    const pool = new pg.Pool({ connectionString: url, max: 20 });
    pool.on("connect", (client) => {
        const original = client.query.bind(client) as (...a: unknown[]) => unknown;
        const counted = (...a: unknown[]) => {
            counters.queries++;
            counters.lastAt = performance.now();
            const first = a[0];
            const text = typeof first === "string" ? first : (first && typeof first === "object" && "text" in first ? String(first.text) : "");
            if (/^\s*begin/i.test(text)) counters.refetchTx++;
            return original(...a);
        };
        Object.assign(client, { query: counted });
    });
    const writerPool = new pg.Pool({ connectionString: url, max: 4 });

    const registry = new FixtureTableRegistry();
    registry.registerMultiple([notesCollection]);
    registry.registerPgTable(notesTable, "notes");
    const realtime = new RealtimeService(drizzle(pool), registry);
    const readDriver = new PostgresBackendDriver(drizzle(pool), realtime, registry);
    realtime.setDataDriver(readDriver);
    readDriver.rlsUserRole = REBASE_USER_ROLE;
    realtime.rlsUserRole = REBASE_USER_ROLE;
    // Writes go through their own pool, so its statements are not counted.
    const writer = new PostgresBackendDriver(drizzle(writerPool), realtime, registry);
    writer.rlsUserRole = REBASE_USER_ROLE;

    const tables = [{ schema: "public", table: "notes", identityColumns: ["id"] }];
    await realtime.enableWalCdc(url, tables);

    const sockets: Array<{ ws: CollectingSocket; uid: string }> = [];
    for (let i = 0; i < n; i++) {
        const uid = scenario === "tabs" || i === 0 ? "alice" : `user${i}`;
        const ws = new CollectingSocket();
        const clientId = `c${i}`;
        realtime.addClient(clientId, ws);
        const filter = scenario.startsWith("own-rows") ? { owner: ["==", uid] } : undefined;
        await realtime.handleClientMessage(clientId, {
            type: "subscribe_collection",
            payload: { path: "notes", subscriptionId: "s", ...(filter ? { filter } : {}) }
        }, { uid, roles: ["user"] });
        sockets.push({ ws, uid });
    }
    // Let every first fetch land and the pool go quiet.
    await waitUntil(() => performance.now() - counters.lastAt > 1000, 600_000);

    const marker = `marker-${randomUUID()}`;
    for (const { ws } of sockets) ws.marker = marker;
    const expected = sockets.filter((s) => s.uid === "alice").map((s) => s.ws);

    counters.queries = 0;
    counters.refetchTx = 0;
    let committedAt: number;
    if (scenario === "own-rows/sql") {
        await admin.query("INSERT INTO public.notes (id, owner, body) VALUES ($1, 'alice', $2)", [randomUUID(), marker]);
        committedAt = performance.now();
    } else {
        const asAlice = await writer.withAuth({ uid: "alice", roles: ["user"], displayName: null, email: null, photoURL: null, providerId: "bench", isAnonymous: false });
        await asAlice.save({ path: "notes", id: randomUUID(), values: { owner: "alice", body: marker }, status: "new" });
        committedAt = performance.now();
    }
    counters.lastAt = performance.now();
    await waitUntil(() => expected.every((ws) => ws.sawAt !== undefined), 600_000);
    // The fan-out is over once the pool has been quiet for a second.
    await waitUntil(() => performance.now() - counters.lastAt > 1000, 600_000);

    const seen = expected.map((ws) => ws.sawAt!).sort((a, b) => a - b);
    const result: Result = {
        scenario, n,
        refetchTx: counters.refetchTx,
        queries: counters.queries,
        firstMs: Math.round(seen[0] - committedAt),
        allMs: Math.round(seen[seen.length - 1] - committedAt),
        settledMs: Math.round(counters.lastAt - committedAt)
    };

    await realtime.destroy();
    await pool.end();
    await writerPool.end();
    return result;
}

// ── Main ─────────────────────────────────────────────────────────────────

const pgInstance = startPostgres();
const cleanup = () => { if (!args.keep) spawnSync("docker", ["rm", "-f", "-v", pgInstance.name], { stdio: "ignore" }); };
process.once("exit", cleanup);
process.once("SIGINT", () => { cleanup(); process.exit(130); });

const admin = await connectWithRetry(pgInstance.url);
await admin.query(`
    CREATE TABLE public.notes (id varchar PRIMARY KEY, owner varchar, body varchar);
    CREATE INDEX notes_owner ON public.notes (owner);
    ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY notes_own ON public.notes FOR ALL TO public
        USING (owner = current_setting('app.uid', true))
        WITH CHECK (owner = current_setting('app.uid', true));
`);
const runSql = async (text: string) => (await admin.query(text)).rows as Record<string, unknown>[];
await ensureAppRole(runSql, ["public"]);
await provisionWalPublication(runSql, [{ schema: "public", table: "notes", identityColumns: ["id"] }]);

const scenarios: Scenario[] = ["own-rows/api", "own-rows/sql", "shared-list", "tabs"];
const results: Result[] = [];
console.log(`root: ${args.root}`);
console.log(["scenario".padEnd(14), "N".padStart(5), "refetch tx".padStart(11), "queries".padStart(8), "first ms".padStart(9), "all ms".padStart(8), "settled ms".padStart(11)].join(" "));
for (const scenario of scenarios) {
    for (const n of args.subscribers) {
        const r = await runScenario(pgInstance.url, admin, scenario, n);
        results.push(r);
        console.log([r.scenario.padEnd(14), String(r.n).padStart(5), String(r.refetchTx).padStart(11), String(r.queries).padStart(8), String(r.firstMs).padStart(9), String(r.allMs).padStart(8), String(r.settledMs).padStart(11)].join(" "));
    }
}
console.log(JSON.stringify(results));
await admin.end();
process.exit(0);
