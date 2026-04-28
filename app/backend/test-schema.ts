import { pgTable, varchar, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
export const users = pgTable("users", {
    id: varchar("id").primaryKey(),
    name: varchar("name")
}, (table) => [
    pgPolicy("policy_B", {
        as: "permissive",
        for: "all",
        to: ["public"],
        using: sql`true`
    })
]).enableRLS();
