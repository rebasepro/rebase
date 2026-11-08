/**
 * What the data plane costs next to the SQL it runs: `dataAsAdmin` against raw
 * `rebase.sql()` on the same tables, on a scratch database of the local
 * Postgres. Runs the workspace's source, not a published build.
 *
 *     TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx tooling/scripts/bench-data-plane.mts
 *     … bench-data-plane.mts --delay-ms 1.35          # through a proxy that holds each packet 1.35 ms each way
 *     … bench-data-plane.mts --iters 500 --keep       # more runs; leave the database for the next run
 *     … bench-data-plane.mts --database-url postgresql://me@127.0.0.1:5432/postgres
 *
 * The collections are modelled on a real app's (a song catalogue of ~45
 * columns, an append-only event log, a leaderboard keyed by day and player)
 * and provisioned the way a server boot does, policies included, so every
 * `dataAsAdmin` call runs as the service identity under row-level security.
 *
 * For each case it prints p50/p95 wall time of both sides, and for the SDK side
 * how many round trips one call makes and how many statements it sends. A
 * round trip is one `client.query` (a pipelined batch is one); statements
 * count every statement inside it. `--delay-ms` starts a TCP proxy in a child
 * process, so a round trip costs what it does against a database in another
 * zone; the direct numbers show the CPU.
 *
 * `--cpu` adds the CPU time per call of the read cases, from
 * `process.cpuUsage`, which is where row mapping shows.
 *
 * The scratch database is `rebase_bench_data_plane`; it is dropped at the end
 * unless `--keep` is passed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import type { CollectionConfig } from "@rebasepro/types";

// The driver's own copy of pg, so the counter below wraps the client it uses.
const require = createRequire(new URL("../../packages/server-postgres/package.json", import.meta.url));
const pg = require("pg") as typeof import("pg");

const { values: args } = parseArgs({
    options: {
        "database-url": { type: "string", default: "postgresql://127.0.0.1:5432/postgres" },
        "delay-ms": { type: "string", default: "0" },
        iters: { type: "string", default: "300" },
        songs: { type: "string", default: "30000" },
        keep: { type: "boolean", default: false },
        cpu: { type: "boolean", default: false },
        trace: { type: "boolean", default: false },
        only: { type: "string" }
    }
});

const DB_NAME = "rebase_bench_data_plane";
const ITERS = Number(args.iters);
const N_SONGS = Number(args.songs);
const DELAY_MS = Number(args["delay-ms"]);

// ── Round trips and statements, counted where pg sends them ────────────────
let roundTrips = 0;
let statements = 0;
let traced: string[] | undefined;
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function countedQuery(this: unknown, ...rest: unknown[]) {
    const q = rest[0] as { text?: string; statementCount?: number } | string;
    roundTrips += 1;
    if (traced) {
        const batch = typeof q === "object" && q && "statements" in q ? (q as unknown as { statements: { text: string }[] }).statements.map(s => s.text) : [typeof q === "string" ? q : q?.text ?? "?"];
        traced.push(batch.map(t => t.replace(/\s+/g, " ").slice(0, 140)).join("\n        + "));
    }
    statements += typeof q === "object" && q && typeof q.statementCount === "number"
        ? q.statementCount
        : (typeof q === "string" ? q : q?.text ?? "").split(";").filter(s => s.trim()).length || 1;
    return (originalQuery as (...a: unknown[]) => unknown).apply(this, rest);
} as typeof pg.Client.prototype.query;

const { createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase } =
    await import("../../packages/server-postgres/src/index.ts");
const { logger } = await import("../../packages/server/src/index.ts");
for (const level of ["info", "debug", "warn"] as const) (logger as unknown as Record<string, () => void>)[level] = () => undefined;

// ── Collections ────────────────────────────────────────────────────────────
const adminOnly = [
    { operation: "select" as const, roles: ["admin"] },
    { operations: ["insert" as const, "update" as const, "delete" as const], roles: ["admin"] }
];

const songs: CollectionConfig = {
    name: "Songs", slug: "songs", table: "bench_songs", securityRules: adminOnly,
    properties: {
        id: { name: "Id", type: "number", isId: "manual", columnType: "bigint" },
        cover: { name: "Cover", type: "string" },
        title: { name: "Title", type: "string", validation: { required: true } },
        artist: { name: "Artist", type: "string", validation: { required: true } },
        artistId: { name: "Artist id", type: "number", columnType: "bigint" },
        year: { name: "Year", type: "number", validation: { integer: true } },
        decade: { name: "Decade", type: "number", validation: { integer: true } },
        genre: { name: "Genre", type: "string" },
        lang: { name: "Lang", type: "string" },
        home: { name: "Home", type: "string" },
        market: { name: "Market", type: "string" },
        banned: { name: "Banned", type: "boolean", defaultValue: false, validation: { required: true } },
        playable: { name: "Playable", type: "boolean", defaultValue: true, validation: { required: true } },
        difficulty: { name: "Difficulty", type: "number", validation: { integer: true } },
        fame: { name: "Fame", type: "number", columnType: "real", defaultValue: 0, validation: { required: true } },
        rank: { name: "Rank", type: "number", defaultValue: 0, validation: { required: true, integer: true } },
        rankHome: { name: "Rank home", type: "number", validation: { integer: true } },
        plays: { name: "Plays", type: "number", defaultValue: 0, validation: { required: true, integer: true } },
        hits: { name: "Hits", type: "number", defaultValue: 0, validation: { required: true, integer: true } },
        misses: { name: "Misses", type: "number", defaultValue: 0, validation: { required: true, integer: true } },
        skips: { name: "Skips", type: "number", defaultValue: 0, validation: { required: true, integer: true } },
        tags: { name: "Tags", type: "array", columnType: "text[]", of: { name: "Tag", type: "string" } },
        countries: { name: "Countries", type: "array", columnType: "text[]", of: { name: "Country", type: "string" } },
        charts: { name: "Charts", type: "array", columnType: "text[]", of: { name: "Chart", type: "string" } },
        misfit: { name: "Misfit", type: "array", columnType: "text[]", of: { name: "Mix", type: "string" } },
        duration: { name: "Duration", type: "number", validation: { integer: true } },
        chorusAt: { name: "Chorus at", type: "number", columnType: "real" },
        hasLyrics: { name: "Has lyrics", type: "boolean" },
        lyricOk: { name: "Lyric ok", type: "boolean" },
        lrc: { name: "LRC", type: "string" },
        coverOf: { name: "Cover of", type: "number", columnType: "bigint" },
        dupOf: { name: "Dup of", type: "number", columnType: "bigint" },
        langSrc: { name: "Lang source", type: "string" },
        langRead: { name: "Lang read", type: "boolean" },
        wd: { name: "Wikidata", type: "string" },
        links: { name: "Links", type: "number", defaultValue: 0, validation: { required: true, integer: true } },
        wikiEs: { name: "Wiki es", type: "boolean", defaultValue: false, validation: { required: true } },
        wikiEn: { name: "Wiki en", type: "boolean", defaultValue: false, validation: { required: true } },
        cons: { name: "Cons", type: "map", keyValue: true, properties: {}, columnType: "jsonb" },
        build: { name: "Build", type: "string" },
        checkedAt: { name: "Checked", type: "date" },
        genreAt: { name: "Genre at", type: "date" },
        createdAt: { name: "Created", type: "date", autoValue: "on_create" },
        updatedAt: { name: "Updated", type: "date", autoValue: "on_update" }
    }
} as CollectionConfig;

const events: CollectionConfig = {
    name: "Events", slug: "events", table: "bench_events", securityRules: adminOnly,
    properties: {
        id: { name: "Id", type: "number", isId: true, columnType: "bigserial" },
        at: { name: "At", type: "date", autoValue: "on_create" },
        kind: { name: "Kind", type: "string", validation: { required: true } },
        page: { name: "Page", type: "string" },
        room: { name: "Room", type: "string" },
        dev: { name: "Device", type: "string" },
        lang: { name: "Lang", type: "string" },
        sid: { name: "Visit", type: "string" },
        props: { name: "Props", type: "map", keyValue: true, properties: {}, columnType: "jsonb" }
    }
} as CollectionConfig;

const dailyScores: CollectionConfig = {
    name: "Daily scores", slug: "daily_scores", table: "bench_daily", securityRules: adminOnly,
    properties: {
        day: { name: "Day", type: "string", isId: "manual" },
        sid: { name: "Player", type: "string", isId: "manual" },
        name: { name: "Name", type: "string" },
        hype: { name: "Hype", type: "number", columnType: "bigint", validation: { required: true } },
        songs: { name: "Songs", type: "number", columnType: "integer" },
        rights: { name: "Rights", type: "number", columnType: "integer" },
        won: { name: "Won", type: "boolean" },
        at: { name: "At", type: "date", autoValue: "on_create" }
    }
} as CollectionConfig;

const collections = [songs, events, dailyScores];

// ── Database ───────────────────────────────────────────────────────────────
function urlFor(base: string, name: string, port?: number): string {
    const url = new URL(base);
    url.pathname = `/${name}`;
    if (port) url.port = String(port);
    return url.toString();
}

const adminUrl = args["database-url"]!;
const benchUrl = urlFor(adminUrl, DB_NAME);
{
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
    if (!rowCount) await admin.query(`CREATE DATABASE ${DB_NAME}`);
    await admin.end();
}
{
    // What a server boot does to the database: tables, RLS runtime, policies, the restricted role.
    const conn = createPostgresDatabaseConnection(benchUrl);
    try {
        const bootstrapper = createPostgresBootstrapper({ connectionString: benchUrl, connection: conn.db });
        const driverResult = await bootstrapper.initializeDriver({ collections, realtime: { subscribe: false, provision: false } });
        await bootstrapper.ensureCollectionSchema!(collections, driverResult);
        await bootstrapper.ensureRlsRuntime!(driverResult);
        await bootstrapper.ensureCollectionPolicies!(collections, driverResult);
        await bootstrapper.finalizeSecurityPosture!(driverResult);
    } finally {
        await conn.pool.end();
    }
}

// ── The proxy, in a child process so its timers do not share our event loop ─
let proxy: ChildProcess | undefined;
let port = Number(new URL(adminUrl).port || 5432);
if (DELAY_MS > 0) {
    const listen = 55_000 + Math.floor(Math.random() * 5_000);
    const code = `
        const net = require("node:net");
        const [listen, delay, upstream] = [+process.argv[1], +process.argv[2], +process.argv[3]];
        const hold = (from, to) => from.on("data", (b) => setTimeout(() => to.write(b), delay));
        net.createServer((c) => {
            const pg = net.connect(upstream, "127.0.0.1");
            c.setNoDelay(true); pg.setNoDelay(true);
            hold(c, pg); hold(pg, c);
            const end = () => { c.destroy(); pg.destroy(); };
            c.on("error", end); pg.on("error", end); c.on("close", end); pg.on("close", end);
        }).listen(listen, "127.0.0.1", () => process.stdout.write("ready\\n"));`;
    proxy = spawn(process.execPath, ["-e", code, String(listen), String(DELAY_MS), String(port)], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>(resolve => proxy!.stdout!.once("data", () => resolve()));
    port = listen;
}

const rb = await openRebase({ databaseUrl: urlFor(benchUrl, DB_NAME, port), collections, pool: { max: 4 } });
type Sql = (q: string, o?: { params?: unknown[] }) => Promise<Record<string, unknown>[]>;
const sql = rb.sql as unknown as Sql;
// The accessors are typed from a registered Database this script has none of.
const data = rb.dataAsAdmin as unknown as Record<string, {
    findById(id: unknown): Promise<unknown>;
    find(o: unknown): Promise<unknown>;
    count(o: unknown): Promise<unknown>;
    createMany(rows: unknown[], o?: unknown): Promise<unknown>;
    update(id: unknown, values: unknown): Promise<unknown>;
}>;

const LANGS = ["es", "en", "pt", "it", "fr"];
const songRow = (k: number) => ({
    id: 1_000_000 + k, title: `Song ${k}`, artist: `Artist ${k % 3000}`, year: 1960 + (k % 65),
    decade: 1960 + 10 * Math.floor((k % 65) / 10), genre: ["Pop", "Rock", "Latin", "Dance"][k % 4],
    lang: LANGS[k % 5], banned: k % 97 === 0, playable: k % 13 !== 0, difficulty: k % 101,
    fame: (k * 7919) % 1000 / 10, rank: (k * 104729) % 900000,
    tags: [`lang:${LANGS[k % 5]}`, `decade:${1960 + 10 * Math.floor((k % 65) / 10)}`], countries: ["ES", "US"].slice(0, 1 + (k % 2))
});
const SONG_COLS = ["id", "title", "artist", "year", "decade", "genre", "lang", "banned", "playable", "difficulty", "fame", "rank", "tags", "countries"];

const [{ n }] = await sql("SELECT count(*)::int AS n FROM bench_songs");
if (Number(n) < N_SONGS) {
    // Seeded with raw SQL so the seed does not depend on what is being measured.
    for (let i = Number(n); i < N_SONGS; i += 1000) {
        const rows = Array.from({ length: Math.min(1000, N_SONGS - i) }, (_, j) => songRow(i + j));
        await sql(
            `INSERT INTO bench_songs (${SONG_COLS.map(c => `"${c.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`)}"`).join(", ")}) VALUES ${rows.map((_, r) => `(${SONG_COLS.map((_, c) => `$${r * SONG_COLS.length + c + 1}`).join(", ")})`).join(", ")} ON CONFLICT DO NOTHING`,
            { params: rows.flatMap(r => SONG_COLS.map(c => (r as Record<string, unknown>)[c])) }
        );
    }
    await sql("ANALYZE bench_songs");
}

// ── Timing ─────────────────────────────────────────────────────────────────
interface Timing { p50: number; p95: number; cpuUs: number; trips: number; stmts: number }
async function time(fn: (i: number) => Promise<unknown>, iters: number): Promise<Timing> {
    for (let i = 0; i < Math.min(20, iters); i++) await fn(i);
    roundTrips = 0; statements = 0;
    if (args.trace && fn.name === "sdk") traced = [];
    await fn(iters + 1);
    if (traced) { console.log(`  ${traced.length} round trips:\n${traced.map(t => `    - ${t}`).join("\n")}`); traced = undefined; }
    const trips = roundTrips, stmts = statements;
    const ms: number[] = [];
    const cpu = process.cpuUsage();
    for (let i = 0; i < iters; i++) {
        const t = performance.now();
        await fn(i);
        ms.push(performance.now() - t);
    }
    const used = process.cpuUsage(cpu);
    ms.sort((a, b) => a - b);
    return { p50: ms[Math.floor(iters * 0.5)], p95: ms[Math.floor(iters * 0.95)], cpuUs: (used.user + used.system) / iters, trips, stmts };
}

const id = (i: number) => 1_000_000 + ((i * 7907) % N_SONGS);
const eventRows = (i: number) => Array.from({ length: 30 }, (_, k) => ({ kind: "song_end", page: "tv", room: "ABCD", sid: `s${i}`, dev: `d${k}`, lang: "es", props: { n: k, right: k % 2 === 0 } }));
let nextBulk = 5_000_000;
const bulkSongs = () => Array.from({ length: 1000 }, () => songRow(nextBulk++ - 1_000_000));

type Case = { name: string; raw: (i: number) => Promise<unknown>; sdk: (i: number) => Promise<unknown>; iters?: number; read?: boolean };
const cases: Case[] = [
    {
        name: "findById", read: true,
        raw: i => sql("SELECT * FROM bench_songs WHERE id = $1", { params: [id(i)] }),
        sdk: i => data.songs.findById(id(i))
    },
    {
        name: "find 30 (filter + order, count none)", read: true,
        raw: i => sql("SELECT * FROM bench_songs WHERE playable AND NOT banned AND lang = $1 AND decade = $2 ORDER BY fame DESC LIMIT 30", { params: [LANGS[i % 5], 1960 + 10 * (i % 6)] }),
        sdk: i => data.songs.find({ where: { playable: ["==", true], banned: ["==", false], lang: ["==", LANGS[i % 5]], decade: ["==", 1960 + 10 * (i % 6)] }, orderBy: ["fame", "desc"], limit: 30, count: "none" })
    },
    {
        name: "find 30 (default count)", read: true,
        raw: i => sql("SELECT * FROM bench_songs WHERE lang = $1 ORDER BY fame DESC LIMIT 30", { params: [LANGS[i % 5]] }),
        sdk: i => data.songs.find({ where: { lang: ["==", LANGS[i % 5]] }, orderBy: ["fame", "desc"], limit: 30 })
    },
    {
        name: "count by filter", read: true,
        raw: i => sql("SELECT count(*)::int AS n FROM bench_songs WHERE playable AND lang = $1", { params: [LANGS[i % 5]] }),
        sdk: i => data.songs.count({ where: { playable: ["==", true], lang: ["==", LANGS[i % 5]] } })
    },
    {
        name: "update one field",
        raw: i => sql("UPDATE bench_songs SET plays = $2, updated_at = now() WHERE id = $1 RETURNING *", { params: [id(i), i] }),
        sdk: i => data.songs.update(id(i), { plays: i })
    },
    {
        name: "createMany 30 events",
        raw: i => {
            const rows = eventRows(i);
            return sql(`INSERT INTO bench_events (kind, page, room, sid, dev, lang, props) VALUES ${rows.map((_, k) => `($${k * 7 + 1}, $${k * 7 + 2}, $${k * 7 + 3}, $${k * 7 + 4}, $${k * 7 + 5}, $${k * 7 + 6}, $${k * 7 + 7}::jsonb)`).join(", ")} RETURNING *`,
                { params: rows.flatMap(r => [r.kind, r.page, r.room, r.sid, r.dev, r.lang, JSON.stringify(r.props)]) });
        },
        sdk: i => data.events.createMany(eventRows(i))
    },
    {
        name: "upsert one row",
        raw: i => sql("INSERT INTO bench_daily (day, sid, hype, songs, rights, won) VALUES ($1, $2, $3, 10, 5, false) ON CONFLICT (day, sid) DO UPDATE SET hype = EXCLUDED.hype RETURNING *", { params: ["2026-11-08", `p${i % 500}`, i] }),
        sdk: i => data.daily_scores.createMany([{ day: "2026-11-08", sid: `q${i % 500}`, hype: i, songs: 10, rights: 5, won: false }], { upsert: true })
    },
    {
        name: "createMany 1,000 songs", iters: 10,
        raw: () => {
            const rows = bulkSongs();
            return sql(`INSERT INTO bench_songs (${SONG_COLS.map(c => `"${c.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`)}"`).join(", ")}) VALUES ${rows.map((_, r) => `(${SONG_COLS.map((_, c) => `$${r * SONG_COLS.length + c + 1}`).join(", ")})`).join(", ")}`,
                { params: rows.flatMap(r => SONG_COLS.map(c => (r as Record<string, unknown>)[c])) });
        },
        sdk: () => data.songs.createMany(bulkSongs())
    }
];

const label = DELAY_MS > 0 ? `through a ${DELAY_MS} ms-each-way proxy` : "direct";
console.log(`\n${label}: p50 / p95 ms, round trips and statements per SDK call${args.cpu ? ", CPU µs per call" : ""}\n`);
const header = ["case".padEnd(38), "sql p50", "sdk p50", "sql p95", "sdk p95", "trips", "stmts"];
if (args.cpu) header.push("sql cpu", "sdk cpu");
console.log(header.join("  "));
const results: Record<string, { raw: Timing; sdk: Timing }> = {};
for (const c of cases) {
    if (args.only && !c.name.includes(args.only)) continue;
    const iters = Math.min(c.iters ?? ITERS, ITERS);
    const { raw: rawFn, sdk } = { raw: c.raw, sdk: c.sdk };
    const raw = await time(rawFn, iters);
    if (args.trace) console.log(c.name);
    const sdkTiming = await time(sdk, iters);
    results[c.name] = { raw, sdk: sdkTiming };
    const line = [c.name.padEnd(38), raw.p50.toFixed(2).padStart(7), sdkTiming.p50.toFixed(2).padStart(7), raw.p95.toFixed(2).padStart(7), sdkTiming.p95.toFixed(2).padStart(7), String(sdkTiming.trips).padStart(5), String(sdkTiming.stmts).padStart(5)];
    if (args.cpu) line.push(raw.cpuUs.toFixed(0).padStart(7), sdkTiming.cpuUs.toFixed(0).padStart(7));
    console.log(line.join("  "));
}
await sql("DELETE FROM bench_songs WHERE id >= 5000000");
await sql("DELETE FROM bench_events");
await rb.close();
proxy?.kill();

if (!args.keep) {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.end();
}
