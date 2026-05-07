import { Db } from "mongodb";

export async function ensureHistoryCollectionExists(db: Db): Promise<void> {
    console.log("🔍 Checking MongoDB history collection and indexes...");

    try {
        const history = db.collection("__rebase_history");
        
        // Index for finding history entries for a specific entity
        await history.createIndex({ entity_id: 1, table_name: 1, updated_at: -1 });

        // Index for pruning by date
        await history.createIndex({ updated_at: 1 });

        console.log("✅ MongoDB History collection ready");
    } catch (error) {
        console.error("❌ Failed to set up MongoDB history collection:", error);
    }
}
