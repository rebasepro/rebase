import { pgTable, uuid, varchar, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name")
}, (table) => [
    pgPolicy("user_policy_renamed", {
        as: "permissive",
        for: "all",
        to: ["public"],
        using: sql`true`
    })
]).enableRLS();

export const tables = { users };
