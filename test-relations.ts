import { config } from "dotenv";
config({ path: "./app/.env" });
import { eq } from "drizzle-orm";
import { createPostgresDatabaseConnection } from "./packages/server-postgresql/src/connection";
import { EntityFetchService } from "./packages/server-postgresql/src/services/EntityFetchService";
import { PostgresCollectionRegistry } from "./packages/server-postgresql/src/collections/PostgresCollectionRegistry";
import { resolveCollectionRelations } from "./packages/common/src/util/relations";
import { getCollectionByPath } from "./packages/server-postgresql/src/services/entity-helpers";
import { RelationService } from "./packages/server-postgresql/src/services/RelationService";
import * as schema from "./app/backend/src/schema.generated";

async function run() {
    if (!process.env.DATABASE_URL) {
        console.error("No DATABASE_URL found");
        process.exit(1);
    }
    
    console.log("Connecting to", process.env.DATABASE_URL.substring(0, 15) + "...");
    const { db, pool } = createPostgresDatabaseConnection(process.env.DATABASE_URL, schema);

    const registry = new PostgresCollectionRegistry();
    const { loadCollectionsFromDirectory } = await import("./packages/server-core/src/collections/loader");
    const collections = await loadCollectionsFromDirectory("./app/config/collections");
    registry.registerMultiple(collections);
    registry.registerEnums(schema.enums);
    registry.registerRelations(schema.relations);
    for (const [key, val] of Object.entries(schema.tables)) {
        registry.registerTable(val, key);
    }

    const fetchService = new EntityFetchService(db, registry);
    const relationService = new RelationService(db, registry);
    
    // Fetch a single post
    const posts = await fetchService.fetchEntitiesWithConditions("posts", { limit: 50, relations: ["profile"] });
    console.log("Post 34:", JSON.stringify(posts.find(p => String(p.id) === "34"), null, 2));

    if (posts.length === 0) {
        console.log("No posts found.");
        process.exit(0);
    }
    const postIds = ["34"];

    const collection = getCollectionByPath("posts", registry);
    const parentTable = registry.getTable("posts");
    
    let query = db.select().from(parentTable!).$dynamic();
    
    const authorsTable = registry.getTable("authors")!;
    const profilesTable = registry.getTable("profiles")!;
    
    // mimic what relationService does
    query = query.innerJoin(authorsTable, eq(parentTable!.author_id, authorsTable.id));
    query = query.innerJoin(profilesTable, eq(authorsTable.id, profilesTable.author_id));
    
    // @ts-ignore
    query = query.where(eq(parentTable!.id, postIds[0]));
    
    console.log("SQL:", query.toSQL());
    
    const res = await query;
    console.log("Res:", res);
    
    await pool.end();
    process.exit(0);
}

run().catch(console.error);
