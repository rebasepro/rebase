/** `db generate` finishing the migration Ptah wrote. */
import fs from "fs";
import os from "os";
import path from "path";

import { finishNewMigration, preparePtahMigration, ptahManualMigrationWarning } from "../src/schema/migration-post-process";

const GENERATED_COLUMN_WARNING = "WARNING: Generated column public.tasks.search_vector changed, but ALTER COLUMN SET EXPRESSION requires target capability alter_generated_column_expression, unavailable on this target (PostgreSQL added it in 17); manual migration required.";
const INCOMPLETE_SEARCH_PLAN = `-- ${GENERATED_COLUMN_WARNING}\nCOMMENT ON COLUMN "public"."tasks"."search_vector" IS 'new fingerprint';\n`;

describe("ptahManualMigrationWarning", () => {
    it("finds the warning even when Ptah plans a valid fingerprint comment", () => {
        expect(ptahManualMigrationWarning(`Planned schema changes:\n${INCOMPLETE_SEARCH_PLAN}`)).toBe(GENERATED_COLUMN_WARNING);
        expect(ptahManualMigrationWarning('ALTER TABLE "tasks" ALTER COLUMN "search_vector" SET EXPRESSION AS (new_expression);')).toBeUndefined();
    });
});

describe("preparePtahMigration", () => {
    it("makes generated functions and schemas replayable after auth bootstrap", () => {
        const sql = 'CREATE SCHEMA "rebase";\nCREATE FUNCTION "rebase"."uid"() RETURNS text AS $$ SELECT 1 $$ LANGUAGE sql;\nCREATE FUNCTION "public"."other"() RETURNS text AS $$ SELECT 2 $$ LANGUAGE sql;\n';
        expect(preparePtahMigration(sql, false)).toBe(
            'CREATE SCHEMA IF NOT EXISTS "rebase";\nCREATE OR REPLACE FUNCTION "rebase"."uid"() RETURNS text AS $$ SELECT 1 $$ LANGUAGE sql;\nCREATE FUNCTION "public"."other"() RETURNS text AS $$ SELECT 2 $$ LANGUAGE sql;\n'
        );
    });

    it("uses one conditional role creation when Ptah emits an unconditional one", () => {
        const sql = 'CREATE ROLE "rebase_admin" WITH NOLOGIN NOINHERIT;\nCREATE TABLE "public"."notes" ("id" bigint);\n';
        const prepared = preparePtahMigration(sql, true);
        expect(prepared).toContain("DO $rebase_admin_role$");
        expect(prepared).toContain('CREATE TABLE "public"."notes"');
        expect(prepared).not.toContain('CREATE ROLE "rebase_admin" WITH');
    });
});

describe("finishNewMigration", () => {
    let dir: string;
    let file: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-migration-"));
        file = path.join(dir, "20261013000000_init.sql");
        fs.writeFileSync(file, "CREATE TABLE \"public\".\"secrets\" (\"id\" uuid);\n");
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("keeps the migration when every step succeeds", async () => {
        const rehash = jest.fn(async () => undefined);
        const outcome = await finishNewMigration(file, async () => {
            fs.appendFileSync(file, "ALTER TABLE \"public\".\"secrets\" ENABLE ROW LEVEL SECURITY;\n");
        }, rehash);

        expect(outcome).toEqual({ ok: true });
        expect(fs.readFileSync(file, "utf-8")).toContain("ENABLE ROW LEVEL SECURITY");
        expect(rehash).not.toHaveBeenCalled();
    });

    it("takes the migration back out, and re-hashes, when a step fails", async () => {
        const rehash = jest.fn(async () => undefined);
        const outcome = await finishNewMigration(file, async () => {
            throw new Error("search.sql could not be read");
        }, rehash);

        expect(outcome).toEqual({ ok: false, error: "search.sql could not be read", removed: true });
        expect(fs.existsSync(file)).toBe(false);
        expect(rehash).toHaveBeenCalledTimes(1);
    });

    it("removes an incomplete migration before its fingerprint comment can be applied", async () => {
        fs.writeFileSync(file, INCOMPLETE_SEARCH_PLAN);
        const rehash = jest.fn(async () => undefined);
        const outcome = await finishNewMigration(file, async () => {
            preparePtahMigration(fs.readFileSync(file, "utf8"), false);
        }, rehash);

        expect(outcome).toEqual({ ok: false, error: GENERATED_COLUMN_WARNING, removed: true });
        expect(fs.existsSync(file)).toBe(false);
        expect(rehash).toHaveBeenCalledTimes(1);
    });

    it("reports a re-hash that fails after the file is gone", async () => {
        const outcome = await finishNewMigration(
            file,
            async () => { throw new Error("boom"); },
            async () => { throw new Error("atlas not found"); }
        );

        expect(outcome).toEqual({ ok: false, error: "boom", removed: true, rehashError: "atlas not found" });
    });
});
