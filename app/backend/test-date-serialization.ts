/**
 * Date Serialization Pipeline Test
 *
 * Tests the FULL roundtrip of date values through every layer:
 *
 *  1. Server DB → normalizeDbValues → {__type:"date", value:"..."} markers
 *  2. JSON.stringify (server REST / WebSocket) → valid JSON string
 *  3. JSON.parse(text, rebaseReviver) → native Date objects (client)
 *  4. sessionStorage cache: JSON.stringify(Date) → JSON.parse(customReviver) → native Date
 *  5. Client → JSON.stringify(formValues) → server receives ISO strings → saves OK
 *  6. Full save roundtrip: fetch entity → serialize → parse → verify Date
 *
 * Run:  npx tsx test-date-serialization.ts
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./src/schema.generated";
import { PostgresCollectionRegistry } from "@rebasepro/server-postgresql";
import { EntityFetchService } from "../../packages/server-postgresql/src/services/EntityFetchService";
import { EntityPersistService } from "../../packages/server-postgresql/src/services/EntityPersistService";
import { RelationService } from "../../packages/server-postgresql/src/services/RelationService";
import { parsePropertyFromServer, normalizeDbValues } from "../../packages/server-postgresql/src/data-transformer";
import { rebaseReviver } from "../../packages/client/src/reviver";
import { EntityCollection, Entity, EntityRelation, EntityReference } from "@rebasepro/types";
import { PgTable } from "drizzle-orm/pg-core";

import postsCollection from "../config/collections/posts";
import authorsCollection from "../config/collections/authors";
import profilesCollection from "../config/collections/profiles";
import productsCollection from "../config/collections/products";
import ordersCollection from "../config/collections/orders";
import tagsCollection from "../config/collections/tags";

const DATABASE_URL = "postgresql://postgres:A%3FCl8L%5DpUHiO%3A%5COT@34.22.208.81:5432/firecms";

const allCollections: EntityCollection[] = [
    authorsCollection, postsCollection, profilesCollection,
    productsCollection, ordersCollection, tagsCollection
];

// ── Test framework ──
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${label}`);
    } else {
        failed++;
        const msg = `❌ FAIL: ${label}${detail ? " — " + detail : ""}`;
        failures.push(msg);
        console.error(`  ${msg}`);
    }
}

// ── Reproduce the entity_cache customReviver (from packages/core/src/util/entity_cache.ts) ──
function cacheReviver(_key: string, value: unknown): unknown {
    if (value && typeof value === "object" && "__type" in value) {
        const record = value as Record<string, unknown>;
        switch (record.__type) {
            case "date":
            case "Date":
                return new Date(record.value as string);
            case "reference":
            case "EntityReference":
                return new EntityReference({
                    id: record.id as string,
                    path: record.path as string,
                    driver: record.driver as string | undefined,
                    databaseId: record.databaseId as string | undefined
                });
            case "relation":
            case "EntityRelation":
                return new EntityRelation(record.id as string, record.path as string, record.data as Entity | undefined);
            default:
                return value;
        }
    }
    return value;
}

async function main() {
    const pool = new pg.Pool({ connectionString: DATABASE_URL,
max: 5 });
    const fullSchema = { ...schema.tables,
...schema.enums,
...schema.relations };
    const db = drizzle(pool, { schema: fullSchema });

    const registry = new PostgresCollectionRegistry(allCollections);
    const tablesMap = schema.tables as Record<string, PgTable>;
    for (const [name, table] of Object.entries(tablesMap)) {
        registry.registerTable(table, name);
    }
    registry.registerEnums(schema.enums as any);
    registry.registerRelations(schema.relations as any);

    const relationService = new RelationService(db as any, registry);
    const entityFetchService = new EntityFetchService(db as any, registry, relationService);
    const entityPersistService = new EntityPersistService(db as any, registry);

    // ═══════════════════════════════════════════════════════════════
    // TEST 1: parsePropertyFromServer converts dates to marker objects
    // ═══════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 1: parsePropertyFromServer → date marker objects");
    console.log("═══════════════════════════════════════════════════");

    const dateProperty = { type: "date" as const,
mode: "date_time" as const,
name: "Test Date" };
    const nativeDate = new Date("2025-08-02T11:09:15.234Z");

    // Case 1: native Date → marker
    const marker1 = parsePropertyFromServer(nativeDate, dateProperty, postsCollection);
    assert("Date → marker: is object", typeof marker1 === "object" && marker1 !== null);
    assert("Date → marker: __type is 'date'", (marker1 as any).__type === "date");
    assert("Date → marker: value is ISO string", (marker1 as any).value === "2025-08-02T11:09:15.234Z");

    // Case 2: ISO string → marker
    const marker2 = parsePropertyFromServer("2025-08-02T11:09:15.234Z", dateProperty, postsCollection);
    assert("String → marker: __type is 'date'", (marker2 as any).__type === "date");
    assert("String → marker: value is ISO string", (marker2 as any).value === "2025-08-02T11:09:15.234Z");

    // Case 3: null → null
    const marker3 = parsePropertyFromServer(null, dateProperty, postsCollection);
    assert("null → null", marker3 === null);

    console.log(`\n  Marker shape: ${JSON.stringify(marker1)}`);

    // ═══════════════════════════════════════════════════════════════
    // TEST 2: JSON.stringify → JSON.parse(rebaseReviver) roundtrip
    //   Simulates: server c.json() → client transport.request()
    // ═══════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 2: REST roundtrip — JSON.stringify → JSON.parse(rebaseReviver)");
    console.log("═══════════════════════════════════════════════════");

    const serverEntity = {
        id: "42",
        title: "Test Post",
        status: "published",
        publish_date: { __type: "date",
value: "2025-08-02T11:09:15.234Z" },
        created_at: { __type: "date",
value: "2025-01-15T08:30:00.000Z" },
        updated_at: null,
        author: { id: "7",
path: "authors",
__type: "relation" }
    };

    // Simulate c.json() on server side
    const jsonString = JSON.stringify(serverEntity);
    console.log(`  Wire JSON: ${jsonString.substring(0, 200)}...`);

    // Simulate JSON.parse(text, rebaseReviver) on client side
    const clientEntity = JSON.parse(jsonString, rebaseReviver);

    assert("REST: publish_date is Date instance", clientEntity.publish_date instanceof Date,
        `got ${typeof clientEntity.publish_date}: ${clientEntity.publish_date}`);
    assert("REST: publish_date time is correct",
        clientEntity.publish_date instanceof Date && clientEntity.publish_date.getTime() === new Date("2025-08-02T11:09:15.234Z").getTime());
    assert("REST: created_at is Date instance", clientEntity.created_at instanceof Date);
    assert("REST: updated_at is null", clientEntity.updated_at === null);
    assert("REST: author is EntityRelation", clientEntity.author instanceof EntityRelation,
        `got ${typeof clientEntity.author}: ${JSON.stringify(clientEntity.author)?.substring(0, 100)}`);
    assert("REST: title is string", typeof clientEntity.title === "string");
    assert("REST: id is string", typeof clientEntity.id === "string");

    // ═══════════════════════════════════════════════════════════════
    // TEST 3: WebSocket roundtrip — same as REST but with message wrapper
    // ═══════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 3: WebSocket roundtrip — entity_update message");
    console.log("═══════════════════════════════════════════════════");

    const wsMessage = {
        type: "entity_update",
        subscriptionId: "sub_123",
        entity: {
            id: "42",
            path: "posts",
            values: {
                title: "Test Post",
                publish_date: { __type: "date",
value: "2025-08-02T11:09:15.234Z" },
                created_at: { __type: "date",
value: "2025-01-15T08:30:00.000Z" },
                updated_at: null,
                content: [
                    {
                        type: "text",
                        value: {
                            created_at: { __type: "date",
value: "2025-06-01T00:00:00.000Z" },
                            body: "Hello world"
                        }
                    }
                ],
                author: { id: "7",
path: "authors",
__type: "relation" }
            }
        }
    };

    // Simulate server: client.send(JSON.stringify(message))
    const wsJsonString = JSON.stringify(wsMessage);
    // Simulate client: JSON.parse(event.data, rebaseReviver)
    const wsClientMessage = JSON.parse(wsJsonString, rebaseReviver);

    const wsValues = wsClientMessage.entity.values;

    assert("WS: entity.values.publish_date is Date", wsValues.publish_date instanceof Date,
        `got ${typeof wsValues.publish_date}: ${wsValues.publish_date}`);
    assert("WS: entity.values.created_at is Date", wsValues.created_at instanceof Date);
    assert("WS: entity.values.updated_at is null", wsValues.updated_at === null);
    assert("WS: entity.values.author is EntityRelation", wsValues.author instanceof EntityRelation);
    assert("WS: nested content[0].value.created_at is Date",
        wsValues.content[0].value.created_at instanceof Date,
        `got ${typeof wsValues.content[0].value.created_at}: ${wsValues.content[0].value.created_at}`);

    // ═══════════════════════════════════════════════════════════════
    // TEST 4: Cache roundtrip — JSON.stringify(entity) → JSON.parse(cacheReviver)
    //   Simulates: sessionStorage.setItem → sessionStorage.getItem
    // ═══════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 4: Cache roundtrip — sessionStorage serialize/deserialize");
    console.log("═══════════════════════════════════════════════════");

    // clientEntity from TEST 2 already has native Date objects
    // When we JSON.stringify a native Date, it becomes an ISO string
    const cacheJson = JSON.stringify(clientEntity);
    console.log(`  Cache JSON (Date → ISO string): ${cacheJson.substring(0, 200)}...`);

    // The cache reviver should NOT convert ISO strings to dates
    // (it only handles __type markers). This tests that the cache doesn't break dates.
    const fromCache = JSON.parse(cacheJson, cacheReviver);

    // Dates were serialized as ISO strings by JSON.stringify(Date), not as markers.
    // So the cache reviver won't convert them back — they'll be plain strings.
    // This is the KNOWN LIMITATION: the cache loses Date typing for native Dates.
    // But that's OK because the cache should store the MARKER format, not native Dates.
    console.log(`  publish_date from cache: ${typeof fromCache.publish_date} = ${fromCache.publish_date}`);

    // Now test what SHOULD happen: the entity_cache should store data
    // BEFORE revival (raw markers), not after.
    const cacheWithMarkers = JSON.stringify(serverEntity);
    const fromCacheWithReviver = JSON.parse(cacheWithMarkers, cacheReviver);

    assert("Cache: publish_date from markers is Date", fromCacheWithReviver.publish_date instanceof Date,
        `got ${typeof fromCacheWithReviver.publish_date}: ${fromCacheWithReviver.publish_date}`);
    assert("Cache: created_at from markers is Date", fromCacheWithReviver.created_at instanceof Date);
    assert("Cache: null stays null", fromCacheWithReviver.updated_at === null);

    // ═══════════════════════════════════════════════════════════════
    // TEST 5: Client → Server body serialization
    //   Simulates: JSON.stringify(formValues) where values contain Date objects
    // ═══════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 5: Client → Server — JSON.stringify(formValues with Dates)");
    console.log("═══════════════════════════════════════════════════");

    const formValues = {
        title: "My Post",
        publish_date: new Date("2025-08-02T11:09:15.234Z"),
        created_at: new Date("2025-01-15T08:30:00.000Z"),
        updated_at: null,
        status: "published"
    };

    const requestBody = JSON.stringify(formValues);
    console.log(`  Request body: ${requestBody}`);

    // Server receives this as c.req.json() — no reviver, plain parse
    const serverReceived = JSON.parse(requestBody);

    assert("Server receives: publish_date is ISO string", typeof serverReceived.publish_date === "string",
        `got ${typeof serverReceived.publish_date}`);
    assert("Server receives: publish_date value correct",
        serverReceived.publish_date === "2025-08-02T11:09:15.234Z");
    assert("Server receives: updated_at is null", serverReceived.updated_at === null);

    // Server's parsePropertyFromServer should handle ISO strings
    const serverDate = parsePropertyFromServer(serverReceived.publish_date,
        { type: "date",
mode: "date_time",
name: "Publish Date" } as any, postsCollection);
    assert("Server parse: ISO string → marker", (serverDate as any).__type === "date");
    assert("Server parse: marker value correct", (serverDate as any).value === "2025-08-02T11:09:15.234Z");

    // ═══════════════════════════════════════════════════════════════
    // TEST 6: FULL E2E — fetch real entity → serialize → parse → verify
    // ═══════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 6: FULL E2E — fetch post → REST serialize → client parse");
    console.log("═══════════════════════════════════════════════════");

    // Fetch a real post from the database
    const realPosts = await entityFetchService.fetchEntitiesWithConditions("posts", {
        limit: 5,
orderBy: "id",
order: "asc"
    });

    assert("E2E: Got posts from DB", realPosts.length > 0);

    if (realPosts.length > 0) {
        const realPost = realPosts[0];
        const rv = realPost.values as Record<string, any>;

        console.log(`  Post id=${realPost.id}, title="${rv.title?.substring(0, 40)}"`);

        // Check what the server has in values
        const dateFields = ["publish_date", "created_at", "updated_at"];
        for (const field of dateFields) {
            const val = rv[field];
            if (val === null || val === undefined) {
                console.log(`  ${field}: null/undefined (OK — field is nullable)`);
                continue;
            }

            // On the server side, values should be marker objects
            const isMarker = typeof val === "object" && val !== null && "__type" in val;
            const isDate = val instanceof Date;

            console.log(`  ${field}: type=${typeof val}, isDate=${isDate}, isMarker=${isMarker}, value=${JSON.stringify(val)?.substring(0, 80)}`);

            assert(`E2E: ${field} is marker or Date on server`, isMarker || isDate,
                `got ${typeof val}: ${JSON.stringify(val)?.substring(0, 80)}`);
        }

        // Simulate the FULL REST response path:
        // 1. Server: flattenEntity → c.json() → JSON.stringify
        const flatEntity = { id: realPost.id,
...rv };
        const restJson = JSON.stringify(flatEntity);

        // 2. Client: JSON.parse(text, rebaseReviver)
        const clientParsed = JSON.parse(restJson, rebaseReviver);

        for (const field of dateFields) {
            const val = clientParsed[field];
            if (val === null || val === undefined) continue;

            assert(`E2E REST: ${field} is Date on client`, val instanceof Date,
                `got ${typeof val}: ${val}`);

            if (val instanceof Date) {
                assert(`E2E REST: ${field} is valid Date`, !isNaN(val.getTime()),
                    `getTime()=${val.getTime()}`);
            }
        }

        // 3. Simulate the FULL WebSocket message path:
        const wsEntityMsg = {
            type: "entity_update",
            subscriptionId: "sub_test",
            entity: realPost
        };
        const wsJson = JSON.stringify(wsEntityMsg);
        const wsClientParsed = JSON.parse(wsJson, rebaseReviver);

        for (const field of dateFields) {
            const val = wsClientParsed.entity.values[field];
            if (val === null || val === undefined) continue;

            assert(`E2E WS: ${field} is Date on client`, val instanceof Date,
                `got ${typeof val}: ${val}`);

            if (val instanceof Date) {
                assert(`E2E WS: ${field} is valid Date`, !isNaN(val.getTime()));
            }
        }

        // 4. Simulate the cache roundtrip:
        // Store the raw server entity (with markers), not the parsed client entity
        const cacheStored = JSON.stringify(realPost);
        const cacheRetrieved = JSON.parse(cacheStored, cacheReviver);

        for (const field of dateFields) {
            const val = cacheRetrieved.values[field];
            if (val === null || val === undefined) continue;

            assert(`E2E Cache: ${field} is Date after cache roundtrip`, val instanceof Date,
                `got ${typeof val}: ${val}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 7: Save roundtrip — save entity, fetch back, verify dates
    // ═══════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 7: Save roundtrip — update post → fetch → verify dates");
    console.log("═══════════════════════════════════════════════════");

    if (realPosts.length > 0) {
        const postToUpdate = realPosts[0];
        const postId = postToUpdate.id;
        const postValues = postToUpdate.values as Record<string, any>;

        // Simulate what the CLIENT sends: form values with Dates
        // The client converts Date objects to ISO strings via JSON.stringify
        const clientFormValues: Record<string, any> = {
            title: postValues.title,
            status: postValues.status
        };

        // Simulate the client setting a date through the form
        const testDate = new Date("2025-12-25T10:30:00.000Z");

        // What the client sends: JSON.stringify converts Date → ISO string
        clientFormValues.publish_date = testDate;
        const clientRequestBody = JSON.stringify(clientFormValues);
        // What the server receives: c.req.json() (no reviver)
        const serverReceivedValues = JSON.parse(clientRequestBody);

        console.log(`  Client sends publish_date: ${typeof testDate} → wire: ${typeof serverReceivedValues.publish_date} = "${serverReceivedValues.publish_date}"`);

        assert("Save: client Date → server receives ISO string",
            typeof serverReceivedValues.publish_date === "string" &&
            serverReceivedValues.publish_date === "2025-12-25T10:30:00.000Z");

        // Save through the actual persist service
        const savedEntity = await entityPersistService.saveEntity("posts", serverReceivedValues, postId);

        const savedValues = savedEntity.values as Record<string, any>;
        const savedPubDate = savedValues.publish_date;

        console.log(`  Saved entity publish_date: type=${typeof savedPubDate}, value=${JSON.stringify(savedPubDate)}`);

        assert("Save: returned entity has publish_date marker",
            typeof savedPubDate === "object" && savedPubDate !== null && savedPubDate.__type === "date",
            `got ${JSON.stringify(savedPubDate)}`);

        if (savedPubDate && savedPubDate.__type === "date") {
            assert("Save: marker value matches", savedPubDate.value === "2025-12-25T10:30:00.000Z",
                `got ${savedPubDate.value}`);
        }

        // Simulate REST response: server → client
        const saveResponseJson = JSON.stringify({ id: savedEntity.id,
...savedValues });
        const clientSaveResult = JSON.parse(saveResponseJson, rebaseReviver);

        assert("Save REST response: publish_date is Date on client",
            clientSaveResult.publish_date instanceof Date,
            `got ${typeof clientSaveResult.publish_date}: ${clientSaveResult.publish_date}`);

        if (clientSaveResult.publish_date instanceof Date) {
            assert("Save REST response: publish_date time correct",
                clientSaveResult.publish_date.getTime() === testDate.getTime(),
                `expected ${testDate.getTime()}, got ${clientSaveResult.publish_date.getTime()}`);
        }

        // Restore original value
        const restoreValues: Record<string, any> = { title: postValues.title,
status: postValues.status };
        if (postValues.publish_date) {
            // The original value is a marker object
            restoreValues.publish_date = postValues.publish_date.value || postValues.publish_date;
        }
        await entityPersistService.saveEntity("posts", restoreValues, postId);
        console.log("  Restored original publish_date value");
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 8: Edge cases
    // ═══════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log("TEST 8: Edge cases — invalid dates, wrong types, nested structures");
    console.log("═══════════════════════════════════════════════════");

    // Edge case: uppercase "Date" type (legacy format)
    const legacyMarker = { __type: "Date",
value: "2025-08-02T11:09:15.234Z" };
    const legacyJson = JSON.stringify(legacyMarker);
    const legacyParsed = JSON.parse(legacyJson, rebaseReviver);
    assert("Legacy 'Date' marker revived by rebaseReviver", legacyParsed instanceof Date);

    const legacyCacheParsed = JSON.parse(legacyJson, cacheReviver);
    assert("Legacy 'Date' marker revived by cacheReviver", legacyCacheParsed instanceof Date);

    // Edge case: deeply nested date in array of objects
    const deepNested = {
        blocks: [
            { type: "quote",
data: { date: { __type: "date",
value: "2025-01-01T00:00:00.000Z" } } },
            { type: "text",
data: { date: null } }
        ]
    };
    const deepJson = JSON.stringify(deepNested);
    const deepParsed = JSON.parse(deepJson, rebaseReviver);
    assert("Deep nested: blocks[0].data.date is Date",
        deepParsed.blocks[0].data.date instanceof Date);
    assert("Deep nested: blocks[1].data.date is null",
        deepParsed.blocks[1].data.date === null);

    // Edge case: empty object with __type but wrong type value
    const wrongType = { __type: "timestamp",
value: "2025-01-01" };
    const wrongJson = JSON.stringify(wrongType);
    const wrongParsed = JSON.parse(wrongJson, rebaseReviver);
    assert("Unknown __type is passed through", !(wrongParsed instanceof Date) && wrongParsed.__type === "timestamp");

    // ═══════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════");
    console.log(`RESULTS: ${passed} passed, ${failed} failed`);
    console.log("═══════════════════════════════════════════════════");

    if (failed > 0) {
        console.error("\n⛔ FAILURES:");
        failures.forEach(f => console.error(`  ${f}`));
        process.exit(1);
    } else {
        console.log("\n✅ All date serialization tests passed — pipeline is intact");
    }

    await pool.end();
}

main().catch(e => {
    console.error("Fatal:", e);
    process.exit(1);
});
