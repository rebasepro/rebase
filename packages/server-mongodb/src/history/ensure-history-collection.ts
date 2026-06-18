import { Db } from "mongodb";
import { logger } from "@rebasepro/server-core";

export async function ensureHistoryCollectionExists(db: Db): Promise<void> {
    logger.info("🔍 Checking MongoDB history collection and indexes...");

    try {
        const history = db.collection("__rebase_history");

        // Index for finding history entries for a specific entity
        await history.createIndex({ entity_id: 1,
table_name: 1,
updated_at: -1 });

        // Index for pruning by date
        await history.createIndex({ updated_at: 1 });

        logger.info("✅ MongoDB History collection ready");
    } catch (error) {
        logger.error("❌ Failed to set up MongoDB history collection", { error: error });
    }
}
