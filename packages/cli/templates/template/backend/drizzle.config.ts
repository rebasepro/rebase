import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "drizzle-kit";
import { tables } from "./src/schema.generated";
import { getTableName } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the project root (single file for the entire project)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Make sure .env file exists in the project root and contains DATABASE_URL");
}

// Extract table names from the generated schema.
// This ensures drizzle-kit ONLY manages tables defined in the schema.
// Any tables in the database that are NOT part of the Rebase schema are left untouched.
const tableNames = Object.values(tables).map(table => getTableName(table as PgTable));

// Dynamically extract all schemas defined in the generated tables to ensure Drizzle Kit manages them.
const schemas = Array.from(new Set(
    Object.values(tables)
        .map(table => getTableConfig(table as PgTable).schema || "public")
));

export default defineConfig({
    schema: "./src/schema.generated.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL
    },
    // Only manage tables defined in the generated schema.
    // Unmapped tables in the database are completely ignored.
    tablesFilter: tableNames,
    // Restrict drizzle-kit to the schemas defined in our collections
    schemaFilter: schemas.length > 0 ? schemas : ["public"],
    // Prevent drizzle-kit from managing roles not defined in the schema
    entities: {
        roles: false
    },
    // If PostGIS or other extensions create helper tables, ignore them
    extensionsFilters: ["postgis"]
});
