import type { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";

/** Drizzle PgTable with column access by name. Runtime Drizzle tables satisfy this shape. */
export type RebasePgTable = PgTable & Record<string, AnyPgColumn>;
