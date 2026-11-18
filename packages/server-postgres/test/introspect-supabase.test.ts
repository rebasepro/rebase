/**
 * Introspecting a Supabase schema: what used to come out half-translated.
 *
 * A column default of `auth.uid()` failed the first push (`schema "auth" does
 * not exist`), policies kept `TO authenticated` for a role a Rebase database
 * does not have, a foreign key to `auth.users` was dropped without a word,
 * plain indexes were dropped, and functions and triggers were never mentioned.
 * Reproduced on the Triptelier migrations (13 tables, 7 functions, 2
 * triggers) against a throwaway Postgres with a Supabase shim; these are the
 * same shapes, in the catalogue rows `readSchemaMetadata` returns.
 */
import { generateSchemaModules } from "../src/schema/introspect-db-logic";
import { classifyTables } from "../src/schema/introspect-db-structure";
import { isCallerIdDefault, plainIndexes, renderLeftBehindSql, translateSupabaseRoles } from "../src/schema/introspect-foreign";
import { buildSchema, check, column, rlsPolicy } from "./helpers/schema-metadata";

const OWNER = "(owner_id = ( SELECT auth.uid() AS uid))";

function agencies() {
    const loaded = buildSchema({
        tables: [{
            name: "agencies",
            columns: [
                column("agencies", "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" }),
                column("agencies", "owner_id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO", column_default: "auth.uid()" }),
                column("agencies", "name", { is_nullable: "NO" }),
                column("agencies", "created_at", { data_type: "timestamp with time zone", udt_name: "timestamptz" })
            ]
        }],
        policies: [rlsPolicy("agencies", "agencies_owner", { roles: ["authenticated"], qual: OWNER, with_check: OWNER })],
        checks: [check("agencies", "CHECK ((char_length(name) >= 1) AND (char_length(name) <= 200))", "agencies_name_check")]
    });
    loaded.metadata.externalFks = [{
        table_name: "agencies", column_name: "owner_id", foreign_table_name: "users", foreign_column_name: "id",
        constraint_name: "agencies_owner_id_fkey", ordinal: 1, delete_rule: "CASCADE", foreign_schema: "auth"
    }];
    loaded.metadata.indexDefinitions = [{
        table_name: "agencies", index_name: "agencies_created_idx", method: "btree", unique: false,
        column_names: ["created_at"], descending: [true], predicate: null,
        definition: "CREATE INDEX agencies_created_idx ON public.agencies USING btree (created_at DESC)"
    }, {
        table_name: "agencies", index_name: "agencies_lower_name", method: "btree", unique: false,
        column_names: null, descending: [false], predicate: null,
        definition: "CREATE INDEX agencies_lower_name ON public.agencies USING btree (lower(name))"
    }];
    loaded.metadata.objects = [
        { kind: "function", name: "get_public_proposal(p_token uuid)", table_name: null, definition: "CREATE OR REPLACE FUNCTION public.get_public_proposal(p_token uuid) RETURNS jsonb LANGUAGE sql AS $$ select '{}'::jsonb $$" },
        { kind: "trigger", name: "agencies_guard", table_name: "agencies", definition: "CREATE TRIGGER agencies_guard BEFORE UPDATE ON public.agencies FOR EACH ROW EXECUTE FUNCTION guard()" }
    ];
    return loaded;
}

function generate() {
    const { metadata, tables } = agencies();
    const generation = generateSchemaModules({ metadata, classifications: classifyTables(metadata, tables) });
    const module = generation.tables.find(t => t.table === "agencies")?.schemaModule;
    if (!module) throw new Error("no agencies module");
    return { generation, module };
}

describe("introspecting a Supabase schema", () => {
    it("turns an auth.uid() default on a uuid user column into a text column the server stamps", () => {
        const { module } = generate();
        expect(module).toMatch(/ownerId: col\.text\(\)[^\n]*\.onCreateUser\(\)[^\n]*\.userId\(\)/);
        // The header note names what it was; the code does not.
        expect(module.replace(/^\/\/.*$/gm, "")).not.toContain("auth.uid()");
        expect(module).not.toMatch(/default\(sql/);
    });

    it("drops TO authenticated, and keeps the owner rule as it was (an owner is signed in)", () => {
        const { module } = generate();
        expect(module).not.toContain("pgRoles");
        expect(module).toContain("rebase.uid()");
    });

    it("declares a plain index and reports the one on an expression, with its SQL", () => {
        const { module, generation } = generate();
        expect(module).toContain("indexes:");
        expect(module).toContain("direction: \"desc\"");
        expect(generation.leftBehind.find(item => item.kind === "index")?.sql).toContain("lower(name)");
    });

    it("lists what it did not carry over: functions, triggers, CHECKs and the foreign key to auth.users", () => {
        const { generation } = generate();
        const kinds = generation.leftBehind.map(item => `${item.kind}:${item.name}`);
        expect(kinds).toEqual(expect.arrayContaining([
            "function:get_public_proposal(p_token uuid)",
            "trigger:agencies_guard",
            "check:agencies_name_check",
            "foreign key:agencies_owner_id_fkey"
        ]));
        const sql = renderLeftBehindSql("public", generation.leftBehind.filter(item => item.sql));
        expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_public_proposal");
        expect(sql).toContain("ADD CONSTRAINT \"agencies_name_check\" CHECK");
    });
});

describe("translateSupabaseRoles", () => {
    it("requires a signed-in caller for TO authenticated on a rule that does not already name the owner", () => {
        const { rule } = translateSupabaseRoles({ name: "read", operation: "select", pgRoles: ["authenticated"], using: "(published = true)" });
        expect(rule).not.toHaveProperty("pgRoles");
        expect(rule && "using" in rule ? rule.using : "").toMatch(/published = true\)\) AND \(.*rebase\.uid\(\).*NOT IN/);
    });

    it("requires a signed-out caller for TO anon, nothing for anon and authenticated together, and drops service_role only rules", () => {
        const anon = translateSupabaseRoles({ name: "insert", operation: "insert", pgRoles: ["anon"], withCheck: "true" }).rule;
        expect(anon && "withCheck" in anon ? anon.withCheck : "").toMatch(/^NOT \(/);
        const both = translateSupabaseRoles({ name: "r", operation: "select", pgRoles: ["anon", "authenticated"], using: "true" }).rule;
        expect(both && "using" in both ? both.using : "").toBe("true");
        expect(translateSupabaseRoles({ name: "svc", operation: "all", pgRoles: ["service_role"], using: "true" }).rule).toBeNull();
        const other = translateSupabaseRoles({ name: "x", operation: "all", pgRoles: ["app_role"], using: "true" }).rule;
        expect(other).toMatchObject({ pgRoles: ["app_role"] });
    });
});

describe("isCallerIdDefault and plainIndexes", () => {
    it("recognises the caller's id in every spelling Postgres prints back", () => {
        for (const raw of ["auth.uid()", "(auth.uid())::text", "( SELECT auth.uid())", "rebase.uid()"]) expect(isCallerIdDefault(raw)).toBe(true);
        expect(isCallerIdDefault("gen_random_uuid()")).toBe(false);
    });

    it("leaves out an index on a link's column alone, which the relation creates", () => {
        const { indexes } = plainIndexes([{
            table_name: "t", index_name: "t_parent_idx", method: "btree", unique: false, column_names: ["parent_id"],
            descending: [false], predicate: null, definition: ""
        }], new Map([["parent_id", "parentId"]]), new Set(["parent_id"]));
        expect(indexes).toEqual([]);
    });
});
