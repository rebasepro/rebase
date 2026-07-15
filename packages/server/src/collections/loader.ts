import { CollectionConfig } from "@rebasepro/types";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { logger } from "../utils/logger";

/**
 * Asynchronously load collection files from a directory for backend initialization
 */
export async function loadCollectionsFromDirectory(directory: string): Promise<CollectionConfig[]> {
    const collections: CollectionConfig[] = [];
    try {
        if (!fs.existsSync(directory)) {
            logger.warn(`[loadCollectionsFromDirectory] Collections directory not found: ${directory}`);
            return collections;
        }

        const files = fs.readdirSync(directory);
        for (const file of files) {
            // Only load .ts and .js files, ignore test files and declaration files
            if ((file.endsWith(".ts") || file.endsWith(".js")) &&
                !file.includes(".test.") &&
                !file.endsWith(".d.ts") &&
                file !== "index.ts" && file !== "index.js") {

                const filePath = path.join(directory, file);
                try {
                    const fileUrl = pathToFileURL(filePath).href;

                    // Use standard import() so that tsx/loader hooks can
                    // resolve .ts files and workspace bare-specifiers.
                    const module = await import(fileUrl);

                    // Expect the collection to be the default export
                    if (module && module.default) {
                        collections.push(module.default);
                    } else {
                        logger.warn(`[loadCollectionsFromDirectory] File ${file} does not have a default export. Skipping.`);
                    }
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    logger.error(`[loadCollectionsFromDirectory] Failed to load collection from ${file}: ${message}`);
                }
            }
        }
    } catch (err) {
        logger.error(`[loadCollectionsFromDirectory] Error reading collections directory: ${err}`);
    }
    return collections;
}
