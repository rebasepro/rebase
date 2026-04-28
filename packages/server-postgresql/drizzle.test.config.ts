import { defineConfig } from "drizzle-kit";

export default defineConfig({
    schema: "./test-schema-no-policies.ts",
    out: "./drizzle-test-out",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres"
    }
});
