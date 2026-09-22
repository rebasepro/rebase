/**
 * A link's default `ON DELETE` follows the nullability its column ends up with.
 *
 * The default is `SET NULL` for an optional link and `RESTRICT` for a required
 * one (`defaultBelongsToOnDelete`), and it was decided from the relation
 * property alone — before anything else had its say about the column:
 *
 * - `tenant` makes its column NOT NULL after the relation was planned, so an
 *   optional `belongsTo` used as the tenant came out `NOT NULL … ON DELETE SET
 *   NULL`. Deleting a parent that still had rows failed with 23502, naming the
 *   child's column, instead of a foreign-key refusal.
 * - a declared property that owns the relation's column decides its
 *   nullability, and the relation's constraint did not look at it.
 *
 * And when that owning property was declared after the relation, `tenant`'s
 * NOT NULL landed on the relation's constraint-only entry, which is not
 * rendered — so the column stayed nullable.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import type { ColumnPlan, SchemaPlan } from "../src/schema/plan/types";

const orgs: CollectionConfig = {
    slug: "orgs",
    table: "orgs",
    name: "Orgs",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
};

const tenantOn = (field: string) => ({ field, from: { claim: "org_id" } });

const orgLink = { name: "Org", type: "relation", relation: { kind: "belongsTo", target: () => orgs } } as const;

const fk = (plan: SchemaPlan, table: string, column: string): string | undefined =>
    plan.tables.find(t => t.table === table)?.columns
        .find(c => c.column === column && c.foreignKey)?.foreignKey?.onDelete;

/** The column as rendered: the entry that is not a relation's constraint-only stand-in. */
const rendered = (plan: SchemaPlan, table: string, column: string): ColumnPlan | undefined =>
    plan.tables.find(t => t.table === table)?.columns
        .find(c => c.column === column && !c.columnOwnedByProperty);

describe("the tenant link", () => {
    it("restricts a parent's delete rather than setting a NOT NULL column to NULL", () => {
        const projects: CollectionConfig = {
            slug: "projects", table: "projects", name: "Projects", tenant: tenantOn("org"),
            properties: { id: { name: "ID", type: "string", isId: "uuid" }, org: orgLink }
        };
        const plan = planSchema([orgs, projects]);
        expect(rendered(plan, "projects", "org_id")?.nullable).toBe(false);
        expect(fk(plan, "projects", "org_id")).toBe("RESTRICT");
        expect(renderPostgresDdl(plan)).toContain('REFERENCES "public"."orgs" ("id") ON DELETE RESTRICT;');
    });

    it("keeps an `onDelete` the author wrote", () => {
        const projects: CollectionConfig = {
            slug: "projects", table: "projects", name: "Projects", tenant: tenantOn("org"),
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                org: { ...orgLink, relation: { ...orgLink.relation, onDelete: "cascade" } }
            }
        };
        expect(fk(planSchema([orgs, projects]), "projects", "org_id")).toBe("cascade");
    });

    it("applies to a `reference` used as the tenant too", () => {
        const projects: CollectionConfig = {
            slug: "projects", table: "projects", name: "Projects", tenant: tenantOn("org"),
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                org: { name: "Org", type: "reference", path: "orgs" }
            }
        };
        expect(fk(planSchema([orgs, projects]), "projects", "org")).toBe("RESTRICT");
    });

    it("makes the column NOT NULL when a property declared after the relation owns it", () => {
        const projects: CollectionConfig = {
            slug: "projects", table: "projects", name: "Projects", tenant: tenantOn("org"),
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                org: { ...orgLink, relation: { ...orgLink.relation, localKey: "org_id" } },
                orgId: { name: "Org id", type: "string", columnName: "org_id", columnType: "uuid" }
            }
        };
        const plan = planSchema([orgs, projects]);
        expect(rendered(plan, "projects", "org_id")?.nullable).toBe(false);
        expect(fk(plan, "projects", "org_id")).toBe("RESTRICT");
        expect(renderPostgresDdl(plan)).toMatch(/"org_id" UUID NOT NULL/);
    });

    it("holds on a live database: the delete is refused by the foreign key", async () => {
        const projects: CollectionConfig = {
            slug: "projects", table: "projects", name: "Projects", tenant: tenantOn("org"),
            properties: { id: { name: "ID", type: "string", isId: "uuid" }, org: orgLink }
        };
        const db = new PGlite();
        try {
            await db.exec(renderPostgresDdl(planSchema([orgs, projects]), { includePolicies: false }));
            await db.exec(
                "INSERT INTO orgs (id) VALUES ('00000000-0000-0000-0000-000000000001');" +
                "INSERT INTO projects (org_id) VALUES ('00000000-0000-0000-0000-000000000001');"
            );
            // 23001 restrict_violation — the constraint refusing, and naming
            // itself — where SET NULL on a NOT NULL column raised 23502.
            await expect(db.exec("DELETE FROM orgs")).rejects.toMatchObject({ code: "23001" });
        } finally {
            await db.close();
        }
    }, 30_000);
});

describe("a link whose column a declared property owns", () => {
    it("restricts when the property is required and the relation says nothing", () => {
        const projects: CollectionConfig = {
            slug: "projects", table: "projects", name: "Projects",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                orgId: { name: "Org id", type: "string", columnName: "org_id", columnType: "uuid", validation: { required: true } },
                org: { ...orgLink, relation: { ...orgLink.relation, localKey: "org_id" } }
            }
        };
        expect(fk(planSchema([orgs, projects]), "projects", "org_id")).toBe("RESTRICT");
    });

    it("still sets NULL when nothing makes the column required", () => {
        const projects: CollectionConfig = {
            slug: "projects", table: "projects", name: "Projects",
            properties: { id: { name: "ID", type: "string", isId: "uuid" }, org: orgLink }
        };
        expect(fk(planSchema([orgs, projects]), "projects", "org_id")).toBe("SET NULL");
    });
});
