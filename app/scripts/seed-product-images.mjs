#!/usr/bin/env node
/**
 * Fix product images by matching demo-products.json image paths
 * to the actual seed-asset filenames, then updating the DB.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_IMAGES_DIR = path.resolve(__dirname, "../seed-assets/product_images");
const DEMO_JSON = path.resolve(__dirname, "../backend/src/demo-products.json");

// 1. Read demo-products.json
const demoProducts = JSON.parse(fs.readFileSync(DEMO_JSON, "utf-8"));
process.stderr.write(`Loaded ${demoProducts.length} products from demo-products.json\n`);

// 2. Build a mapping from the dadaki filename (without prefix) to actual seed file
// Seed files: {hash}_{rest}.jpg → key by {rest}
// Demo JSON: dadaki/{rest}.jpg → key by {rest}
const seedFiles = fs.readdirSync(SEED_IMAGES_DIR).filter(f => /\.(jpg|jpeg|png)$/i.test(f));

const restToSeedFile = new Map();
for (const file of seedFiles) {
    // {hash}_{rest} where rest = B00xxx-yyy.jpg
    const underscoreIdx = file.indexOf("_");
    if (underscoreIdx > 0) {
        const rest = file.substring(underscoreIdx + 1);
        restToSeedFile.set(rest, file);
    }
}
process.stderr.write(`Mapped ${restToSeedFile.size} seed files\n`);

// 3. For each product in demo JSON, resolve image paths and generate SQL
console.log("BEGIN;");

let matchedProducts = 0;
let unmatchedProducts = 0;

for (const product of demoProducts) {
    const name = product.name;
    const demoImages = product.images || [];
    
    if (demoImages.length === 0) continue;
    
    // Resolve each dadaki/ path to a seed file
    const resolvedPaths = [];
    for (const img of demoImages) {
        // img = "dadaki/B000P0MDMS-576916726.jpg"
        const rest = img.replace("dadaki/", "");
        const seedFile = restToSeedFile.get(rest);
        if (seedFile) {
            resolvedPaths.push(`product_images/${seedFile}`);
        }
    }
    
    if (resolvedPaths.length === 0) {
        unmatchedProducts++;
        continue;
    }
    
    // Escape product name for SQL
    const escapedName = name.replace(/'/g, "''");
    const pgArray = `ARRAY[${resolvedPaths.map(p => `'${p}'`).join(",")}]::text[]`;
    console.log(`UPDATE products SET images = ${pgArray} WHERE name = '${escapedName}';`);
    matchedProducts++;
}

console.log("COMMIT;");
process.stderr.write(`\nMatched: ${matchedProducts}, Unmatched: ${unmatchedProducts}\n`);
