import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { tables } from "./src/schema.generated";
import { getTableName } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

// Note: Run from app/backend with DOTENV_CONFIG_PATH=../.env or ensure .env is in the app/ folder
// The parent package.json script should set this, or you can symlink/copy the .env

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Make sure .env file exists in the app/ folder and contains DATABASE_URL");
}

// Extract table names from the generated schema.
// This ensures drizzle-kit ONLY manages tables defined in the schema and ignores all others.
// Any tables in the database that are NOT part of the Rebase schema are left untouched.
// Enums are implicitly scoped — only enums referenced by managed tables are touched.
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
    // Only manage tables and enums defined in the generated schema.
    // Unmapped tables/enums in the database are completely ignored.
    tablesFilter: tableNames,
    // Restrict drizzle-kit to the schemas defined in our collections
    schemaFilter: schemas.length > 0 ? schemas : ["public"],
    // Prevent drizzle-kit from managing roles or sequences not defined in the schema
    entities: {
        roles: false
    },
    // If PostGIS or other extensions create helper tables, ignore them
    extensionsFilters: ["postgis"]
});
