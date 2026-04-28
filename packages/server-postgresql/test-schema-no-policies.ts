import { pgTable, varchar, integer, pgPolicy } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: integer('id').primaryKey(),
  name: varchar('name'),
}, (table) => ([
    pgPolicy("test_policy_renamed", { as: "permissive", for: "all", to: ["public"], using: sql`true` })
])).enableRLS();
