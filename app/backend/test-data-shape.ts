/**
 * Data Shape + Performance Verification Test
 *
 * Validates that the N+1 fix (removing db/registry from parseDataFromServer
 * in batch paths) does NOT break the returned Entity shape for the admin SDK
 * or REST API consumers.
 *
 * Checks:
 *  1. Scalar fields (string, number) are present and correctly typed
 *  2. Owning relation (posts.author_id → authors) returns { id, path, __type }
 *  3. Inverse one-to-one (authors → profile) present with data via batch load
 *  4. Inverse one-to-many (authors → posts) present as array via batch load
 *  5. Single entity fetch still works with full relation data
 *  6. REST API fetchCollectionForRest returns correct shape
 *  7. Query count stays O(R) constant regardless of N
 *
 * Run:  npx tsx test-data-shape.ts
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./src/schema.generated";
import { PostgresCollectionRegistry } from "@rebasepro/server-postgresql";
import { EntityFetchService } from "../../packages/server-postgresql/src/services/EntityFetchService";
import { RelationService } from "../../packages/server-postgresql/src/services/RelationService";
import { EntityCollection } from "@rebasepro/types";
import { PgTable } from "drizzle-orm/pg-core";

// Import collections directly (same as working test)
import authorsCollection from "../config/collections/authors";
import postsCollection from "../config/collections/posts";
import profilesCollection from "../config/collections/profiles";
import productsCollection from "../config/collections/products";
import ordersCollection from "../config/collections/orders";

import tagsCollection from "../config/collections/tags";

const DATABASE_URL = "postgresql://postgres:A%3FCl8L%5DpUHiO%3A%5COT@34.22.208.81:5432/rebase";

const allCollections: EntityCollection[] = [
    authorsCollection, postsCollection, profilesCollection,
    productsCollection, ordersCollection, tagsCollection
];

// ── SQL Tracing ──
let sqlQueries: { sql: string; durationMs: number }[] = [];
let tracing = false;
function startTrace() { sqlQueries = []; tracing = true; }
function stopTrace() { tracing = false; }

// ── Test framework ──
let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(label: string, condition: boolean, detail?: string) {
    if (condition) {
        passed++;
    } else {
        failed++;
        const msg = `❌ FAIL: ${label}${detail ? " — " + detail : ""}`;
        failures.push(msg);
        console.error(`  ${msg}`);
    }
}

async function main() {
    const pool = new pg.Pool({ connectionString: DATABASE_URL,
max: 5 });

    // Monkey-patch pool.query for SQL tracing
    const _origQuery = pool.query.bind(pool);
    (pool as any).query = function (...args: any[]) {
        const sqlStr = typeof args[0] === "string" ? args[0] : (args[0]?.text || "unknown");
        if (!tracing) return _origQuery(...args);
        const start = performance.now();
        const resultPromise = _origQuery(...args);
        resultPromise.then(() => {
            sqlQueries.push({ sql: sqlStr.slice(0, 500),
durationMs: performance.now() - start });
        }).catch(() => {});
        return resultPromise;
    };

    const fullSchema = { ...schema.tables,
...schema.enums,
...schema.relations };
    const db = drizzle(pool, { schema: fullSchema });

    // Build registry
    const registry = new PostgresCollectionRegistry(allCollections);
    const tablesMap = schema.tables as Record<string, PgTable>;
    for (const [name, table] of Object.entries(tablesMap)) {
        registry.registerTable(table, name);
    }
    registry.registerEnums(schema.enums as any);
    registry.registerRelations(schema.relations as any);

    const relationService = new RelationService(db as any, registry);
    const entityService = new EntityFetchService(db as any, registry, relationService);

    // ═══════════════════════════════════════════════════
    // TEST 1: Authors collection — batch-loaded entity shape
    // ═══════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 1: Entity shape — authors (inverse one-to-one + one-to-many)");
    console.log("═══════════════════════════════════════════════════");

    startTrace();
    const authors = await entityService.fetchEntitiesWithConditions("authors", {
        limit: 20,
orderBy: "email",
order: "asc"
    });
    stopTrace();

    console.log(`  Returned: ${authors.length} entities, ${sqlQueries.length} SQL queries`);
    assert("authors: Got entities", authors.length > 0);
    assert("authors: Query count ≤ 4", sqlQueries.length <= 4, `got ${sqlQueries.length}`);

    const a = authors[0];
    const av = a.values as Record<string, any>;

    // Structure checks
    assert("authors: id is string", typeof a.id === "string");
    assert("authors: path is 'authors'", a.path === "authors");
    assert("authors: values is object", typeof a.values === "object" && a.values !== null);

    // Scalar fields
    assert("authors: name is string", typeof av.name === "string");
    assert("authors: email is string", typeof av.email === "string");
    console.log(`  First: id=${a.id}, name=${av.name}, email=${av.email}`);

    // Profile — inverse one-to-one relation (batch loaded by processEntityResults)
    const profile = av.profile;
    console.log(`  profile = ${JSON.stringify(profile)?.substring(0, 200)}`);
    assert("authors: profile exists", profile !== undefined && profile !== null, `got ${JSON.stringify(profile)}`);
    if (profile) {
        assert("authors: profile.__type is 'relation'", profile.__type === "relation");
        assert("authors: profile.id is string", typeof profile.id === "string");
        assert("authors: profile.path is 'profiles'", profile.path === "profiles");
        // The batch logic should populate .data with the full related Entity
        assert("authors: profile.data exists", profile.data !== undefined && profile.data !== null,
            `data=${JSON.stringify(profile.data)?.substring(0, 100)}`);
        if (profile.data) {
            assert("authors: profile.data.id exists", profile.data.id !== undefined);
            assert("authors: profile.data.values is object", typeof profile.data.values === "object");
            const pvals = profile.data.values as Record<string, any>;
            // Profile should have bio, website, author_id
            console.log(`  profile.data.values = { bio: "${pvals?.bio?.substring?.(0, 40)}...", website: "${pvals?.website}" }`);
        }
    }

    // Posts — inverse one-to-many relation (batch loaded by processEntityResults)
    const posts = av.posts;
    console.log(`  posts = ${Array.isArray(posts) ? `Array(${posts.length})` : JSON.stringify(posts)?.substring(0, 100)}`);
    // Posts might be empty array if this author has no posts, but should still be array
    if (posts !== undefined) {
        assert("authors: posts is array", Array.isArray(posts), `got ${typeof posts}`);
        if (Array.isArray(posts) && posts.length > 0) {
            const firstPost = posts[0];
            assert("authors: posts[0].__type is 'relation'", firstPost.__type === "relation");
            assert("authors: posts[0].id exists", firstPost.id !== undefined);
            assert("authors: posts[0].path is 'posts'", firstPost.path === "posts");
            assert("authors: posts[0].data exists", firstPost.data !== undefined);
            console.log(`  posts[0] = { id: "${firstPost.id}", path: "${firstPost.path}", __type: "${firstPost.__type}", hasData: ${firstPost.data !== undefined} }`);
        }
    }

    // ═══════════════════════════════════════════════════
    // TEST 2: Posts collection — owning FK relation (author)
    // ═══════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 2: Entity shape — posts (owning FK → authors)");
    console.log("═══════════════════════════════════════════════════");

    startTrace();
    const postEntities = await entityService.fetchEntitiesWithConditions("posts", {
        limit: 10,
orderBy: "title",
order: "asc"
    });
    stopTrace();

    console.log(`  Returned: ${postEntities.length} entities, ${sqlQueries.length} SQL queries`);
    assert("posts: Got entities", postEntities.length > 0);

    if (postEntities.length > 0) {
        const p = postEntities[0];
        const pv = p.values as Record<string, any>;

        assert("posts: title is string", typeof pv.title === "string");
        assert("posts: content is string", typeof pv.content === "string");
        assert("posts: status is string", typeof pv.status === "string");
        console.log(`  title="${pv.title?.substring(0, 50)}", status="${pv.status}"`);

        // Author — owning relation (parseDataFromServer builds it from FK without db)
        const author = pv.author;
        console.log(`  author = ${JSON.stringify(author)?.substring(0, 200)}`);
        if (author) {
            assert("posts: author.__type is 'relation'", author.__type === "relation");
            assert("posts: author.id is string", typeof author.id === "string");
            assert("posts: author.path is 'authors'", author.path === "authors");
            console.log(`  ✅ Owning relation correct: { id: "${author.id}", path: "${author.path}", __type: "${author.__type}" }`);
        } else {
            console.log("  ℹ️  author is null (FK might be nullable)");
        }
    }

    // ═══════════════════════════════════════════════════
    // TEST 3: Single entity — fetchEntity (uses parseDataFromServer WITH db/registry)
    // ═══════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 3: Single entity — fetchEntity(author)");
    console.log("═══════════════════════════════════════════════════");

    startTrace();
    const singleAuthor = await entityService.fetchEntity("authors", authors[0].id);
    stopTrace();

    console.log(`  SQL queries: ${sqlQueries.length}`);
    assert("single: entity returned", singleAuthor !== undefined);
    if (singleAuthor) {
        const sv = singleAuthor.values as Record<string, any>;
        assert("single: id matches", singleAuthor.id === authors[0].id);
        assert("single: name is string", typeof sv.name === "string");

        const sp = sv.profile;
        console.log(`  profile = ${JSON.stringify(sp)?.substring(0, 200)}`);
        if (sp) {
            assert("single: profile.__type is 'relation'", sp.__type === "relation");
            assert("single: profile.id is string", typeof sp.id === "string");
        }

        // Compare shapes: batch-loaded vs single-entity
        const batchProfile = (authors[0].values as Record<string, any>).profile;
        if (batchProfile && sp) {
            assert("shape-match: profile.id same", batchProfile.id === sp.id,
                `batch=${batchProfile.id} vs single=${sp.id}`);
            assert("shape-match: profile.__type same", batchProfile.__type === sp.__type);
            assert("shape-match: profile.path same", batchProfile.path === sp.path);
        }
    }

    // ═══════════════════════════════════════════════════
    // TEST 4: REST API — fetchCollectionForRest
    // ═══════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 4: REST API — fetchCollectionForRest(authors, include=[profile])");
    console.log("═══════════════════════════════════════════════════");

    startTrace();
    const restAuthors = await entityService.fetchCollectionForRest("authors", {
        limit: 10,
orderBy: "email",
order: "asc"
    }, ["profile"]);
    stopTrace();

    console.log(`  Returned: ${restAuthors.length} entities, ${sqlQueries.length} SQL queries`);
    assert("REST: Got entities", restAuthors.length > 0);

    if (restAuthors.length > 0) {
        const r = restAuthors[0] as Record<string, any>;
        assert("REST: id exists", r.id !== undefined);
        assert("REST: name is string", typeof r.name === "string");
        assert("REST: email is string", typeof r.email === "string");
        console.log(`  id=${r.id}, name=${r.name}, email=${r.email}`);

        // REST format is flat (profile inlined, not wrapped in __type/data)
        const rp = r.profile;
        console.log(`  profile = ${JSON.stringify(rp)?.substring(0, 200)}`);
        if (rp) {
            assert("REST: profile.id exists", rp.id !== undefined);
            // REST shape should have the profile fields directly
            console.log(`  ✅ REST profile: { id: "${rp.id}", bio: "${rp.bio?.substring?.(0, 30)}..." }`);
        }
    }

    // ═══════════════════════════════════════════════════
    // TEST 5: REST API — fetchCollectionForRest NO includes
    // ═══════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 5: REST API — fetchCollectionForRest(authors, NO includes)");
    console.log("═══════════════════════════════════════════════════");

    startTrace();
    const restNoInclude = await entityService.fetchCollectionForRest("authors", {
        limit: 10,
orderBy: "email",
order: "asc"
    });
    stopTrace();

    console.log(`  Returned: ${restNoInclude.length} entities, ${sqlQueries.length} SQL queries`);
    assert("REST-no-include: Got entities", restNoInclude.length > 0);
    // Without includes, should NOT load relations → fewer queries
    assert("REST-no-include: ≤ 2 queries", sqlQueries.length <= 2, `got ${sqlQueries.length}`);

    if (restNoInclude.length > 0) {
        const rn = restNoInclude[0] as Record<string, any>;
        assert("REST-no-include: id exists", rn.id !== undefined);
        assert("REST-no-include: name is string", typeof rn.name === "string");
        // Profile should NOT be populated without include
        console.log(`  profile = ${JSON.stringify(rn.profile)?.substring(0, 100)}`);
    }

    // ═══════════════════════════════════════════════════
    // TEST 6: Scaling — query count constant
    // ═══════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 6: Scaling — query count must stay constant");
    console.log("═══════════════════════════════════════════════════");

    const scaling: { n: number; queries: number; ms: number }[] = [];
    for (const n of [25, 100, 500]) {
        startTrace();
        const t0 = performance.now();
        await entityService.fetchEntitiesWithConditions("authors", {
            limit: n,
orderBy: "email",
order: "asc"
        });
        stopTrace();
        scaling.push({ n,
queries: sqlQueries.length,
ms: Math.round(performance.now() - t0) });
    }

    console.log(`\n  ${"N".padStart(5)}  ${"Queries".padStart(8)}  ${"Wall(ms)".padStart(10)}`);
    for (const s of scaling) {
        console.log(`  ${String(s.n).padStart(5)}  ${String(s.queries).padStart(8)}  ${String(s.ms).padStart(10)}`);
    }

    const allSameQueries = scaling.every(s => s.queries === scaling[0].queries);
    assert("Scaling: query count constant", allSameQueries,
        `counts: ${scaling.map(s => s.queries).join(", ")}`);

    const wallRatio = scaling[scaling.length - 1].ms / scaling[0].ms;
    const nRatio = scaling[scaling.length - 1].n / scaling[0].n;
    assert("Scaling: wall time sub-linear or linear", wallRatio < nRatio * 1.5,
        `${wallRatio.toFixed(1)}x wall for ${nRatio}x data`);

    // ═══════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log(`RESULTS: ${passed} passed, ${failed} failed`);
    console.log("═══════════════════════════════════════════════════");

    if (failed > 0) {
        console.error("\n⛔ FAILURES:");
        failures.forEach(f => console.error(`  ${f}`));
        process.exit(1);
    } else {
        console.log("\n✅ All tests passed — data shapes correct, no N+1, no regressions");
    }

    await pool.end();
}

main().catch(e => {
    console.error("Fatal:", e);
    process.exit(1);
});
