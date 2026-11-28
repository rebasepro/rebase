/**
 * Non-compiled RLS postures (`rls: "external"` and `rls: "unmanaged"`) across
 * DDL generation, boot table creation, boot policy ensure, policy pruning,
 * served-table protection, and policy drift — on a real Postgres (PGlite).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, rel } from "@rebasepro/types";
import { compileSchema, printTableSource, tableDefsFromDescriptors } from "@rebasepro/common";

import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    planTablePolicies
} from "../src/schema/generate-postgres-ddl-logic";
import { planSchema } from "../src/schema/plan/plan-schema";
import { diffPlanAgainstCatalogue } from "../src/schema/plan/diff-plan";
import { ensureTablePolicies } from "../src/schema/ensure-policies";
import { prunablePolicies } from "../src/schema/prune-policies";
import { findServedTableProtection, rlsRequiredFor } from "../src/security/served-table-protection";
import { checkPolicyDrift } from "../src/security/policy-drift";

const managed = defineTable("managed_items", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    rls: [{ operation: "select", access: "public" }]
});
const externalProtected = defineTable("ext_protected", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    rls: "external"
});
const externalUnprotected = defineTable("ext_unprotected", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    rls: "external"
});
const unmanaged = defineTable("app_enforced", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    rls: "unmanaged"
});
const extTag = defineTable("ext_tags", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    rls: "external"
});
const extPost = defineTable("ext_posts", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    relations: { tags: rel.manyToMany(() => extTag) },
    rls: "external"
});
const appTag = defineTable("app_tags", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    rls: "unmanaged"
});
const appPost = defineTable("app_posts", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    relations: { tags: rel.manyToMany(() => appTag) },
    rls: "unmanaged"
});

const COMPILED = compileSchema([
    managed,
    externalProtected,
    externalUnprotected,
    unmanaged,
    extTag,
    extPost,
    appTag,
    appPost
]);

describe("non-managed RLS postures (external & unmanaged)", () => {
    describe("DDL, policy planning, and round-trip serialization", () => {
        it("emits zero RLS or policy DDL for external and unmanaged tables and their junctions", () => {
            const ddl = generatePostgresDdl(COMPILED, { includePolicies: true });
            const policiesDdl = generatePostgresPoliciesDdl(COMPILED);
            const plans = planTablePolicies(COMPILED);

            expect(plans.map(p => p.table)).toEqual(["managed_items"]);
            for (const table of ["ext_protected", "ext_unprotected", "app_enforced", "ext_posts_ext_tags", "app_posts_app_tags"]) {
                expect(ddl).not.toContain(`ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY;`);
                expect(policiesDdl).not.toContain(`"${table}"`);
            }
            expect(ddl).toContain('ALTER TABLE "public"."managed_items" ENABLE ROW LEVEL SECURITY;');
            expect(policiesDdl).toContain('ALTER TABLE "public"."managed_items" ENABLE ROW LEVEL SECURITY;');
        });

        it("does not emit enable-rls in boot diff-plan for external or unmanaged tables", () => {
            const diff = diffPlanAgainstCatalogue(planSchema(COMPILED), { tables: new Map(), enums: new Set() });
            const enabledTargets = diff.actions.filter(a => a.kind === "enable-rls").map(a => a.target);
            expect(enabledTargets).toEqual(["public.managed_items"]);
        });

        it("round-trips external and unmanaged through tableDefsFromDescriptors and printTableSource", () => {
            const extDesc = COMPILED.find(t => t.descriptor.slug === "ext_protected")!.descriptor;
            const appDesc = COMPILED.find(t => t.descriptor.slug === "app_enforced")!.descriptor;
            const defs = tableDefsFromDescriptors([extDesc, appDesc]);
            expect(defs[0].brand).toBe("rebase.table");
            expect(defs[1].brand).toBe("rebase.table");
            if (defs[0].brand === "rebase.table") expect(defs[0].config.rls).toBe("external");
            if (defs[1].brand === "rebase.table") expect(defs[1].config.rls).toBe("unmanaged");
            expect(printTableSource(extDesc).code).toContain('rls: "external"');
            expect(printTableSource(appDesc).code).toContain('rls: "unmanaged"');
        });

        it("never marks external or unmanaged live policies as prunable", () => {
            const kept = [
                { schema: "public", table: "managed_items", name: "stray_managed", roles: ["public"], command: "SELECT", hasUsing: true, hasWithCheck: false },
                { schema: "public", table: "ext_protected", name: "hand_written", roles: ["public"], command: "SELECT", hasUsing: true, hasWithCheck: false },
                { schema: "public", table: "app_enforced", name: "hand_written_app", roles: ["public"], command: "SELECT", hasUsing: true, hasWithCheck: false }
            ];
            expect(prunablePolicies(kept, COMPILED).map(p => p.name)).toEqual(["stray_managed"]);
        });

        it("rlsRequiredFor is false for unmanaged and true by default for external", () => {
            const extDesc = COMPILED.find(t => t.descriptor.slug === "ext_protected")!.descriptor;
            const appDesc = COMPILED.find(t => t.descriptor.slug === "app_enforced")!.descriptor;
            expect(rlsRequiredFor(extDesc)).toBe(true);
            expect(rlsRequiredFor(appDesc)).toBe(false);
        });
    });

    describe("against real Postgres (PGlite)", () => {
        let db: PGlite;
        const run = async (text: string) => (await db.query<Record<string, unknown>>(text)).rows;

        beforeAll(async () => {
            db = new PGlite();
            await db.waitReady;
            await db.exec(`
                CREATE SCHEMA IF NOT EXISTS rebase;
                CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.uid', true), '') $$;
                CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.user_roles', true), '') $$;
                CREATE TABLE managed_items (id serial PRIMARY KEY, title text);
                CREATE TABLE ext_protected (id serial PRIMARY KEY, title text);
                ALTER TABLE ext_protected ENABLE ROW LEVEL SECURITY;
                CREATE POLICY hand_written_select ON ext_protected FOR SELECT USING (true);
                CREATE TABLE ext_unprotected (id serial PRIMARY KEY, title text);
                CREATE TABLE app_enforced (id serial PRIMARY KEY, title text);
                CREATE TABLE ext_tags (id serial PRIMARY KEY, name text);
                ALTER TABLE ext_tags ENABLE ROW LEVEL SECURITY;
                CREATE POLICY ext_tags_read ON ext_tags FOR SELECT USING (true);
                CREATE TABLE ext_posts (id serial PRIMARY KEY, title text);
                ALTER TABLE ext_posts ENABLE ROW LEVEL SECURITY;
                CREATE POLICY ext_posts_read ON ext_posts FOR SELECT USING (true);
                CREATE TABLE ext_posts_ext_tags (ext_post_id int NOT NULL, ext_tag_id int NOT NULL, PRIMARY KEY (ext_post_id, ext_tag_id));
                CREATE TABLE app_tags (id serial PRIMARY KEY, name text);
                CREATE TABLE app_posts (id serial PRIMARY KEY, title text);
                CREATE TABLE app_posts_app_tags (app_post_id int NOT NULL, app_tag_id int NOT NULL, PRIMARY KEY (app_post_id, app_tag_id));
            `);
        });

        afterAll(async () => {
            await db.close();
        });

        it("ensureTablePolicies secures managed tables and leaves external/unmanaged tables untouched", async () => {
            await ensureTablePolicies(db, COMPILED, undefined, { adminRoleAvailable: false });
            const rlsRows = await run(
                `SELECT c.relname, c.relrowsecurity FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r'`
            );
            const rlsByTable = new Map(rlsRows.map(r => [String(r.relname), r.relrowsecurity === true]));
            expect(rlsByTable.get("managed_items")).toBe(true);
            expect(rlsByTable.get("ext_protected")).toBe(true);
            expect(rlsByTable.get("ext_unprotected")).toBe(false);
            expect(rlsByTable.get("app_enforced")).toBe(false);

            const extPolicies = await run(`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ext_protected'`);
            expect(extPolicies.map(r => r.policyname)).toEqual(["hand_written_select"]);
        });

        it("findServedTableProtection serves protected external and unmanaged tables, and withholds external tables or junctions with RLS off", async () => {
            const protection = await findServedTableProtection(run, COMPILED, { adminRoleAvailable: false });

            expect(protection.unprotected.map(t => ({ slug: t.slug, problem: t.problem, junction: t.junction }))).toEqual([
                { slug: "ext_unprotected", problem: "rls-off", junction: undefined },
                { slug: "ext_posts", problem: "rls-off", junction: "public.ext_posts_ext_tags" }
            ]);
            // Unmanaged tables are served without withholding, and reported in servedUnprotected.
            expect(protection.servedUnprotected.map(t => t.slug).sort()).toEqual(["app_enforced", "app_posts", "app_tags"]);
            // Protected external table with hand-written policy is served cleanly.
            expect(protection.unprotected.some(t => t.slug === "ext_protected")).toBe(false);
            expect(protection.narrowed.some(t => t.slug === "ext_protected")).toBe(false);
        });

        it("checkPolicyDrift flags external tables with RLS off, ignores external policies as orphans, and skips unmanaged tables", async () => {
            const drift = await checkPolicyDrift(db, COMPILED, { adminRoleAvailable: false });
            expect(drift.missing).toEqual([]);
            expect(drift.orphaned).toEqual([]);
            expect(drift.rlsDisabled.map(t => t.table).sort()).toEqual(["ext_posts_ext_tags", "ext_unprotected"]);
        });
    });
});
