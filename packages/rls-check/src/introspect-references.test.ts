/**
 * Relations a scanned view or foreign key points at, wherever they live.
 *
 * View dependencies were already read across schemas on purpose — a view in
 * `public` over a table in a hidden schema is exactly the case worth catching —
 * but the relations themselves were only read for the scanned schemas. So
 * `CREATE VIEW public.files AS SELECT * FROM storage.objects`, granted to
 * anon, resolved its base to nothing and produced no finding on a default
 * scan (which leaves `storage` out), and a junction table whose foreign key
 * points at `auth.users` was never considered.
 */
import { describe, expect, it } from "vitest";

import { foreignKey, snapshot, table, view, viewRelation } from "../test/fixtures/snapshot";
import { viewBypassesRls } from "./checks/view-bypasses-rls";
import { buildScanResult } from "./cli";
import { outOfScopeReferences, readReferencedRelations, resolveViewDependencies } from "./introspect";

describe("outOfScopeReferences", () => {
    it("names a view's base table and a foreign key's target that the scan did not read", () => {
        const refs = outOfScopeReferences(
            [viewRelation("public", "files"), table("public", "org_members")],
            [view("public", "files", { dependsOn: [{ schema: "storage", table: "objects" }] })],
            [
                foreignKey("public", "org_members", ["user_id"], "auth", "users"),
                foreignKey("public", "org_members", ["org_id"], "public", "orgs")
            ]
        );

        expect(refs).toEqual([
            { schema: "storage", name: "objects" },
            { schema: "auth", name: "users" },
            { schema: "public", name: "orgs" }
        ]);
    });

    it("leaves out what was already read, and names each relation once", () => {
        const refs = outOfScopeReferences(
            [viewRelation("public", "files"), table("storage", "objects")],
            [
                view("public", "files", { dependsOn: [{ schema: "storage", table: "objects" }] }),
                view("public", "files2", { dependsOn: [{ schema: "auth", table: "users" }] })
            ],
            [foreignKey("public", "t", ["user_id"], "auth", "users")]
        );

        expect(refs).toEqual([{ schema: "auth", name: "users" }]);
    });
});

describe("readReferencedRelations", () => {
    it("reads the named relations with parallel schema and name arrays", async () => {
        const calls: { what: string; values?: unknown[] }[] = [];
        const relations = await readReferencedRelations(
            {
                async query<R>(what: string, _text: string, values?: unknown[]): Promise<R[]> {
                    calls.push({ what, values });
                    return [
                        {
                            schema: "storage",
                            name: "objects",
                            kind: "r",
                            owner: "supabase_storage_admin",
                            rls_enabled: true,
                            rls_forced: false,
                            estimated_rows: 12
                        }
                    ] as R[];
                }
            },
            [{ schema: "storage", name: "objects" }, { schema: "auth", name: "users" }]
        );

        expect(calls).toHaveLength(1);
        expect(calls[0].values?.slice(0, 2)).toEqual([["storage", "auth"], ["objects", "users"]]);
        expect(relations).toEqual([
            {
                schema: "storage",
                name: "objects",
                kind: "table",
                owner: "supabase_storage_admin",
                rlsEnabled: true,
                rlsForced: false,
                columns: [],
                estimatedRows: 12
            }
        ]);
    });

    it("asks nothing when nothing is referenced", async () => {
        let asked = false;
        const relations = await readReferencedRelations(
            {
                async query<R>(): Promise<R[]> {
                    asked = true;
                    return [];
                }
            },
            []
        );
        expect(asked).toBe(false);
        expect(relations).toEqual([]);
    });
});

describe("resolveViewDependencies", () => {
    it("follows a view through a view in a schema the scan did not read", () => {
        const deps = resolveViewDependencies([
            { view_schema: "public", view_name: "files", ref_schema: "storage", ref_name: "visible_objects" },
            { view_schema: "storage", view_name: "visible_objects", ref_schema: "storage", ref_name: "objects" }
        ]);

        expect(deps.get(JSON.stringify(["public", "files"]))).toEqual([
            { schema: "storage", table: "visible_objects" },
            { schema: "storage", table: "objects" }
        ]);
    });

    it("keeps a name with a dot in it whole", () => {
        const deps = resolveViewDependencies([
            { view_schema: "public", view_name: "v", ref_schema: "my.schema", ref_name: "t.able" }
        ]);
        expect(deps.get(JSON.stringify(["public", "v"]))).toEqual([{ schema: "my.schema", table: "t.able" }]);
    });
});

describe("a view over a table in an unscanned schema", () => {
    const withStorage = snapshot({
        schemas: ["public"],
        relations: [
            viewRelation("public", "files"),
            // Read because the view references it, not because `storage` is scanned.
            table("storage", "objects", { rlsEnabled: true })
        ],
        views: [view("public", "files", { dependsOn: [{ schema: "storage", table: "objects" }] })],
        grants: [{ schema: "public", table: "files", grantee: "anon", privileges: ["SELECT"] }]
    });

    it("is reported", () => {
        const [f] = viewBypassesRls.run(withStorage);
        expect(f?.id).toBe("view-bypasses-rls");
        expect(f?.title).toContain("storage.objects");
    });

    it("does not count the referenced table as one the scan covered", () => {
        const result = buildScanResult(withStorage, [], {
            connectionString: "postgresql://localhost/app",
            checksRun: 15,
            scannedAt: "2026-09-23T00:00:00.000Z",
            diagnostics: { degraded: [], tlsVerificationDisabled: false, excludedSchemas: [], unrecognizedGrantees: [] }
        });
        expect(result.stats.tables).toBe(0);
        expect(result.stats.tablesWithoutRls).toBe(0);
    });
});
