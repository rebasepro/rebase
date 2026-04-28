import { defineConfig } from "drizzle-kit";
export default defineConfig({
    schema: "./test-schema.ts",
    out: "./drizzle-test",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres"
    }
});
