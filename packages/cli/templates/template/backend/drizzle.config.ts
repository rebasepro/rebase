import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { tables } from "./src/schema.generated";
import { getTableName, Table } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Make sure .env file exists in the project root and contains DATABASE_URL");
}

// Extract table names from the generated schema.
// This ensures drizzle-kit ONLY manages tables defined in the schema.
// Any tables in the database that are NOT part of the Rebase schema are left untouched.
const tableNames = Object.values(tables).map(table => getTableName(table as Table));

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
    // Restrict drizzle-kit to the public schema only — tables in other schemas
    // (e.g. extensions, custom schemas) are never touched.
    schemaFilter: ["public"],
    // Prevent drizzle-kit from managing roles not defined in the schema
    entities: {
        roles: false
    },
    // If PostGIS or other extensions create helper tables, ignore them
    extensionsFilters: ["postgis"]
});
