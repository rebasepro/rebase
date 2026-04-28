import { pgTable, varchar, pgPolicy } from 'drizzle-orm/pg-core';

export const jobs = pgTable("jobs", {
    id: varchar("id").primaryKey()
}, (table) => ({
    authenticated_access: pgPolicy("authenticated_access", { as: "permissive", for: "all", to: ["public"], using: undefined }),
    company_insert_pending: pgPolicy("company_insert_pending3", { as: "permissive", for: "insert", to: ["public"], withCheck: undefined }),
    new_policy: pgPolicy("new_policy", { as: "permissive", for: "select", to: ["public"], using: undefined })
}));
