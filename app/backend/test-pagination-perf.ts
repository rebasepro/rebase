/**
 * Pagination Performance Test
 *
 * Connects directly to Postgres, bootstraps EntityFetchService
 * with the full Drizzle schema, intercepts SQL, and benchmarks.
 *
 * Run:  npx tsx test-pagination-perf.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./src/schema.generated";
import { PostgresCollectionRegistry } from "@rebasepro/server-postgresql";
import { EntityFetchService } from "../../packages/server-postgresql/src/services/EntityFetchService";
import { RelationService } from "../../packages/server-postgresql/src/services/RelationService";
import { getTableName } from "@rebasepro/common";
import { EntityCollection } from "@rebasepro/types";
import { PgTable } from "drizzle-orm/pg-core";

// Import collections directly
import authorsCollection from "../config/collections/authors";
import postsCollection from "../config/collections/posts";
import profilesCollection from "../config/collections/profiles";
import productsCollection from "../config/collections/products";
import ordersCollection from "../config/collections/orders";

import tagsCollection from "../config/collections/tags";

const DATABASE_URL = "postgresql://postgres:A%3FCl8L%5DpUHiO%3A%5COT@34.22.208.81:5432/firecms";

const allCollections: EntityCollection[] = [
    authorsCollection, postsCollection, profilesCollection,
    productsCollection, ordersCollection, tagsCollection
];

// ──── SQL Interceptor ────────────────────────────────────────────────
let sqlQueries: { sql: string; durationMs: number }[] = [];
let tracing = false;

function startTrace() { sqlQueries = []; tracing = true; }
function stopTrace() { tracing = false; }

function printSummary(label: string) {
    const totalMs = sqlQueries.reduce((s, q) => s + q.durationMs, 0);
    console.log(`\n─── ${label} ───`);
    console.log(`  Queries executed : ${sqlQueries.length}`);
    console.log(`  Total SQL time   : ${totalMs.toFixed(1)} ms`);

    const groups: Record<string, { count: number; totalMs: number; samples: string[] }> = {};
    for (const q of sqlQueries) {
        const fromMatch = q.sql.match(/from "(\w+)"/i);
        const key = fromMatch ? `FROM "${fromMatch[1]}"` : q.sql.slice(0, 60);
        if (!groups[key]) groups[key] = { count: 0,
totalMs: 0,
samples: [] };
        groups[key].count++;
        groups[key].totalMs += q.durationMs;
        if (groups[key].samples.length < 1) groups[key].samples.push(q.sql.slice(0, 250));
    }
    console.log("  Query groups:");
    for (const [key, g] of Object.entries(groups).sort((a, b) => b[1].count - a[1].count)) {
        console.log(`    [${g.count}x | ${g.totalMs.toFixed(0)}ms] ${key}`);
        if (g.count <= 2) {
            for (const s of g.samples) console.log(`      → ${s}`);
        }
    }
}

// ──── Main ───────────────────────────────────────────────────────────
async function main() {
    console.log("🔌 Connecting to database...");

    const pool = new pg.Pool({ connectionString: DATABASE_URL,
max: 5 });

    // Monkey-patch pool.query for SQL tracing
    const _origQuery = pool.query.bind(pool);
    (pool as any).query = function (...args: any[]) {
        const sqlStr = typeof args[0] === "string"
            ? args[0]
            : (args[0]?.text || "unknown");

        if (!tracing) return _origQuery(...args);

        const start = performance.now();
        const resultPromise = _origQuery(...args);
        resultPromise.then(() => {
            const elapsed = performance.now() - start;
            sqlQueries.push({ sql: sqlStr.slice(0, 500),
durationMs: elapsed });
        }).catch(() => { /* ignore */ });
        return resultPromise;
    };

    const fullSchema = { ...schema.tables,
...schema.enums,
...schema.relations };
    const db = drizzle(pool, { schema: fullSchema });

    console.log(`📋 Collections: ${allCollections.map(c => c.slug).join(", ")}`);

    // Build registry — constructor takes collections array, NOT schema
    const registry = new PostgresCollectionRegistry(allCollections);

    // Register tables
    const tablesMap = schema.tables as Record<string, PgTable>;
    for (const [name, table] of Object.entries(tablesMap)) {
        registry.registerTable(table, name);
    }

    // Register enums and relations
    registry.registerEnums(schema.enums as any);
    registry.registerRelations(schema.relations as any);

    const relationService = new RelationService(db as any, registry);
    const entityService = new EntityFetchService(db as any, registry, relationService);

    // Count rows
    const { rows: [{ count: authorsCount }] } = await _origQuery("SELECT count(*) FROM authors");
    const { rows: [{ count: postsCount }] } = await _origQuery("SELECT count(*) FROM posts");
    const { rows: [{ count: profilesCount }] } = await _origQuery("SELECT count(*) FROM profiles");
    console.log("\n📊 Database stats:");
    console.log(`  authors  : ${authorsCount}`);
    console.log(`  posts    : ${postsCount}`);
    console.log(`  profiles : ${profilesCount}`);

    const authorsCol = allCollections.find(c => c.slug === "authors")!;
    const testSizes = [50, 100, 200];
    if (parseInt(authorsCount) >= 500) testSizes.push(500);

    const timings: { n: number; wallMs: number; sqlCount: number; sqlMs: number }[] = [];

    for (const limit of testSizes) {
        console.log("\n═══════════════════════════════════════════════════");
        console.log(`TEST: fetchEntitiesWithConditions — ${limit} authors`);
        console.log("═══════════════════════════════════════════════════");

        startTrace();
        const wallStart = performance.now();
        const results = await entityService.fetchEntitiesWithConditions(
            "authors",
            { limit,
orderBy: "email",
order: "asc" }
        );
        const wallEnd = performance.now();
        stopTrace();

        const wallMs = wallEnd - wallStart;
        const sqlMs = sqlQueries.reduce((s, q) => s + q.durationMs, 0);

        console.log(`  Returned   : ${results.length} entities`);
        console.log(`  Wall time  : ${wallMs.toFixed(0)} ms`);
        printSummary(`${limit} authors — SQL breakdown`);

        timings.push({ n: limit,
wallMs,
sqlCount: sqlQueries.length,
sqlMs });

        // Data correctness for first test
        if (limit === testSizes[0] && results.length > 0) {
            console.log("\n  ── Data Correctness ──");
            const first = results[0];
            const vals = first.values as Record<string, unknown>;
            console.log(`  ID: ${first.id}, name: ${vals.name}, email: ${vals.email}`);

            const profile = vals.profile;
            if (profile && typeof profile === "object") {
                const p = profile as Record<string, unknown>;
                console.log(`  profile: __type=${p.__type}, hasData=${p.data !== undefined}`);
            } else {
                console.log(`  profile: ${JSON.stringify(profile)?.slice(0, 80)}`);
            }

            const posts = vals.posts;
            if (Array.isArray(posts)) {
                console.log(`  posts: array, count=${posts.length}`);
            } else {
                console.log(`  posts: ${JSON.stringify(posts)?.slice(0, 120)}`);
            }
        }
    }

    // ──── Scaling analysis ────────────────────────────────────────
    console.log("\n═══════════════════════════════════════════════════");
    console.log("SCALING ANALYSIS");
    console.log("═══════════════════════════════════════════════════");
    console.log(`  ${"N".padStart(5)}  ${"Wall(ms)".padStart(10)}  ${"SQL#".padStart(6)}  ${"SQL(ms)".padStart(10)}  ${"ms/entity".padStart(10)}`);
    for (const t of timings) {
        console.log(`  ${String(t.n).padStart(5)}  ${t.wallMs.toFixed(0).padStart(10)}  ${String(t.sqlCount).padStart(6)}  ${t.sqlMs.toFixed(0).padStart(10)}  ${(t.wallMs / t.n).toFixed(2).padStart(10)}`);
    }

    const first = timings[0];
    const last = timings[timings.length - 1];
    const queryScale = last.sqlCount / first.sqlCount;
    const nScale = last.n / first.n;
    const wallScale = last.wallMs / first.wallMs;

    console.log(`\n  N scale factor    : ${nScale}x`);
    console.log(`  Query count scale : ${first.sqlCount} → ${last.sqlCount} (${queryScale.toFixed(2)}x)`);
    console.log(`  Wall time scale   : ${first.wallMs.toFixed(0)} → ${last.wallMs.toFixed(0)} ms (${wallScale.toFixed(2)}x)`);

    if (queryScale < 2) {
        console.log("\n  ✅ PASS: Query count is ~constant regardless of N — no N+1");
    } else if (queryScale < nScale * 0.5) {
        console.log("\n  ⚠️  WARN: Query count grows but sub-linearly");
    } else {
        console.log("\n  ❌ FAIL: N+1 detected — query count scales with entity count");
    }

    if (wallScale < nScale * 1.5) {
        console.log(`  ✅ PASS: Wall time scales linearly or better (${wallScale.toFixed(1)}x for ${nScale}x data)`);
    } else {
        console.log(`  ❌ FAIL: Wall time scales super-linearly (${wallScale.toFixed(1)}x for ${nScale}x data)`);
    }

    await pool.end();
    console.log("\n✅ Test complete.");
}

main().catch(e => {
    console.error("❌ Test failed:", e);
    process.exit(1);
});
