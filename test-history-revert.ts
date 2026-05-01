import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { PostgresBackendDriver } from "./packages/server-postgresql/src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "./packages/server-postgresql/src/collections/PostgresCollectionRegistry";
import { HistoryService } from "./packages/server-postgresql/src/history/HistoryService";
import { RealtimeService } from "./packages/server-postgresql/src/services/realtimeService";

async function main() {
    const client = new pg.Pool({ connectionString: "postgresql://postgres:postgres@localhost:5432/rebase" });
    const db = drizzle(client);
    const registry = new PostgresCollectionRegistry();
    // Assuming there's a test collection
    registry.register({
        slug: "test_history",
        properties: {
            title: { type: "string" }
        },
        history: true
    });
    
    // We need to create the table
    await client.query(`
        CREATE TABLE IF NOT EXISTS test_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title TEXT
        );
    `);
    
    const realtimeService = new RealtimeService();
    const historyService = new HistoryService(db);
    const driver = new PostgresBackendDriver(db, realtimeService, registry, undefined, undefined, historyService);
    
    // Create entity
    const entity = await driver.saveEntity({
        path: "test_history",
        values: { title: "Version 1" },
        status: "new"
    });
    
    console.log("Created entity:", entity.id);
    
    // Update entity
    await driver.saveEntity({
        path: "test_history",
        entityId: entity.id,
        values: { title: "Version 2" },
        status: "existing"
    });
    
    // Update entity again
    await driver.saveEntity({
        path: "test_history",
        entityId: entity.id,
        values: { title: "Version 3" },
        status: "existing"
    });
    
    const history = await historyService.fetchHistory("test_history", entity.id);
    console.log("History entries before revert:", history.total);
    
    const v2History = history.data.find(h => h.values.title === "Version 2");
    
    console.log("Reverting to v2 (history id:", v2History.id, ")");
    
    // Simulate revert
    await driver.saveEntity({
        path: "test_history",
        entityId: entity.id,
        values: v2History.values,
        status: "existing"
    });
    
    const historyAfter = await historyService.fetchHistory("test_history", entity.id);
    console.log("History entries after revert:", historyAfter.total);
    
    process.exit(0);
}

main().catch(console.error);
