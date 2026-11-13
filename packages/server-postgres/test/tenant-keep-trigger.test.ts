/**
 * `tenant` installs a trigger that keeps a row in its tenant (see
 * `src/schema/plan/tenant-keep-trigger.ts`). Pinned here: the boot-time ensure
 * installs it once, re-creates it when `bypassRoles` changes, and the owner —
 * which is not the request role — may still move a row. The refusal itself,
 * as the request role, is in `test/e2e/caller-sql-e2e.test.ts`.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import {
    ensureTables,
    readExistingSchema,
    planTableSchemaEnsure
} from "../src/schema/ensure-tables";
import { compileSet } from "./helpers/plan-tables";

const notes = (bypassRoles?: string[]): CollectionConfig => ({
    slug: "notes",
    table: "notes",
    name: "Notes",
    tenant: { field: "orgId", from: { claim: "org_id" }, ...(bypassRoles ? { bypassRoles } : {}) },
    properties: {
        id: { type: "number", isId: "increment" },
        orgId: { type: "string", columnName: "org_id", validation: { required: true } },
        body: { type: "string" }
    }
});

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(sql: string) => {
        const result = await db.query<T>(sql);
        return { rows: result.rows };
    }
});

describe("tenant immutability is a database trigger", () => {
    let db: PGlite;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
    });

    afterEach(async () => {
        await db.close();
    });

    it("is installed once, and re-created when the bypass roles change", async () => {
        const client = queryable(db);
        const first = await ensureTables(client, compileSet([notes()]));
        expect(first.failures).toEqual([]);
        expect(first.actions.filter(a => a.kind === "create-trigger").map(a => a.sql).join("\n"))
            .toContain("EXECUTE FUNCTION rebase.keep_tenant('org_id', 'admin')");

        const same = planTableSchemaEnsure(compileSet([notes()]), await readExistingSchema(client, ["public"]));
        expect(same.actions.filter(a => a.kind === "create-trigger")).toEqual([]);

        const changed = planTableSchemaEnsure(compileSet([notes(["admin", "support"])]), await readExistingSchema(client, ["public"]));
        expect(changed.actions.filter(a => a.kind === "create-trigger").map(a => a.sql))
            .toEqual([
                "DROP TRIGGER IF EXISTS \"notes_keep_tenant\" ON \"public\".\"notes\";",
                "CREATE TRIGGER \"notes_keep_tenant\" BEFORE UPDATE ON \"public\".\"notes\" FOR EACH ROW EXECUTE FUNCTION rebase.keep_tenant('org_id', 'admin', 'support');"
            ]);
    });

    it("leaves the owner free to move a row", async () => {
        await ensureTables(queryable(db), compileSet([notes()]));
        await db.exec("INSERT INTO public.notes (org_id, body) VALUES ('a', 'x')");
        await db.exec("UPDATE public.notes SET org_id = 'b'");
        expect((await db.query<{ org_id: string }>("SELECT org_id FROM public.notes")).rows).toEqual([{ org_id: "b" }]);
    });
});
