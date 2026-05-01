import { config } from "dotenv";
config({ path: "../.env" });
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgresql";
import { enums, relations, tables } from "./src/schema.generated";
import { PostgresCollectionRegistry } from "../../packages/server-postgresql/src/collections/PostgresCollectionRegistry";
import { EntityFetchService } from "../../packages/server-postgresql/src/services/EntityFetchService";
import postsCollection from "../config/collections/posts";
import profilesCollection from "../config/collections/profiles";

async function run() {
    const { db, pool } = createPostgresDatabaseConnection(process.env.DATABASE_URL!, undefined, {
        max: 1
    });

    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([postsCollection, profilesCollection] as any[]);
    Object.entries(tables).forEach(([name, table]) => {
        registry.registerTable(table as any, name);
    });
    registry.registerEnums(enums as any);
    registry.registerRelations(relations as any);

    const fetchService = new EntityFetchService(db, registry);

    try {
        console.log("Fetching posts for REST with author_profile...");
        const result = await fetchService.fetchCollectionForRest("posts", { limit: 2 }, ["author_profile"]);
        console.log("Result:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
