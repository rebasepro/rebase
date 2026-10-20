/**
 * `findUnmigratedSchema` — the offline half of `rebase verify`'s migration
 * step: do the migration files still build what the collections declare?
 *
 * The migrations below are written the way Atlas writes them (quoted,
 * schema-qualified, one action per statement or several comma-separated),
 * followed by the kind of DDL `db generate` appends after Atlas's half —
 * dollar-quoted function bodies full of `;` and `--`, and `ADD COLUMN IF NOT
 * EXISTS` for the columns Atlas is never shown.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { findUnmigratedSchema, replayMigrationTables } from "../src/schema/migration-freshness";

const notes = {
    slug: "notes",
    table: "notes",
    name: "Notes",
    properties: {
        id: { type: "string", isId: "uuid" },
        title: { type: "string" },
        body: { type: "string" }
    }
} as unknown as CollectionConfig;

const INIT = `
-- Create "notes" table
CREATE TABLE "public"."notes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "title" character varying(255) NULL,
  "legacy" text NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "notes_title_key" UNIQUE ("title")
);
CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
  -- not a comment we should read; CREATE TABLE "public"."ghost" ("x" int);
  SELECT current_setting('app.user_id', true);
$$ LANGUAGE sql STABLE;
ALTER TABLE "public"."notes" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;
`;

describe("replayMigrationTables", () => {
    it("reads columns from CREATE TABLE and skips table constraints", () => {
        const tables = replayMigrationTables([INIT]);
        expect([...tables.keys()]).toEqual(["public.notes"]);
        expect([...tables.get("public.notes")!.columns].sort()).toEqual(["id", "legacy", "search_vector", "title"]);
    });

    it("does not read SQL inside a dollar-quoted body", () => {
        expect(replayMigrationTables([INIT]).has("public.ghost")).toBe(false);
    });

    it("replays adds, drops, renames and table drops in order", () => {
        const tables = replayMigrationTables([
            INIT,
            `ALTER TABLE "public"."notes" DROP COLUMN "legacy", ADD COLUMN "body" text NULL;
             ALTER TABLE "public"."notes" RENAME COLUMN "title" TO "heading";
             CREATE TABLE "public"."scratch" ("id" int);
             DROP TABLE "public"."scratch";`
        ]);
        expect([...tables.get("public.notes")!.columns].sort()).toEqual(["body", "heading", "id", "search_vector"]);
        expect(tables.has("public.scratch")).toBe(false);
    });
});

describe("findUnmigratedSchema", () => {
    it("names a table no migration creates", () => {
        expect(findUnmigratedSchema([notes], [])).toEqual([
            { kind: "missing-table", table: "public.notes", slug: "notes" }
        ]);
    });

    it("names a declared column no migration adds, and a dropped one a migration still creates", () => {
        const changes = findUnmigratedSchema([notes], [INIT]);
        expect(changes).toEqual(expect.arrayContaining([
            { kind: "missing-column", table: "public.notes", column: "body", slug: "notes" },
            { kind: "removed-column", table: "public.notes", column: "legacy", slug: "notes" }
        ]));
        // Appended with IF NOT EXISTS, so not Atlas's — never "removed".
        expect(changes.some(c => c.column === "search_vector")).toBe(false);
    });

    it("is empty once a migration catches up", () => {
        const caughtUp = `ALTER TABLE "public"."notes" DROP COLUMN "legacy", ADD COLUMN "body" character varying(255) NULL;`;
        expect(findUnmigratedSchema([notes], [INIT, caughtUp])).toEqual([]);
    });
});
