/**
 * `validation.unique` on a column added to a table that already exists.
 *
 * Boot applied UNIQUE only to a table it was creating in the same run, and
 * withheld it everywhere else without a word: a `handle` declared unique on a
 * live collection arrived as a plain column, duplicates were accepted, and an
 * upsert with `onConflict: "handle"` — which the REST layer allows — failed with
 * 42P10 and a 500. `withheldConstraints` was empty, so nothing said so.
 *
 * A UNIQUE on a column this plan adds cannot fail when there is nothing to
 * compare: the table holds no rows, or the column arrives with no default and so
 * holds NULL in every row, and NULLs are distinct. Those two are applied. A
 * column with a default on a table with rows would give every row the same
 * value, so there the constraint is withheld — and reported.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import {
    ensureCollectionTables,
    planCollectionSchemaEnsure,
    readExistingSchema,
    type ExistingSchema
} from "../src/schema/ensure-collection-tables";

const people = (extra: CollectionConfig["properties"] = {}): CollectionConfig => ({
    slug: "people",
    table: "people",
    name: "People",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Name", type: "string" },
        ...extra
    }
});

const handle = { handle: { name: "Handle", type: "string", validation: { unique: true } } } as const;
const tier = {
    tier: { name: "Tier", type: "string", defaultValue: "free", validation: { unique: true } }
} as const;

/** `people` as it exists before the unique property was declared. */
const existingPeople = (populated: boolean | undefined): ExistingSchema => ({
    tables: new Map([["public.people", new Set(["id", "name"])]]),
    enums: new Set(),
    constraints: new Set(),
    populatedTables: populated === undefined ? undefined : new Set(populated ? ["public.people"] : [])
});

const addColumnSql = (existing: ExistingSchema, collection: CollectionConfig, column: string): string => {
    const plan = planCollectionSchemaEnsure([collection], existing);
    const action = plan.actions.find(a => a.kind === "add-column" && a.target === `public.people.${column}`);
    if (!action) throw new Error(`no add-column for ${column}`);
    return action.sql;
};

const asQueryable = (db: PGlite) => ({
    query: <R,>(text: string, values?: unknown[]) =>
        db.query<R>(text, values as unknown[]) as Promise<{ rows: R[] }>
});

describe("a unique column added to a table that already exists", () => {
    it("is UNIQUE when it arrives with no default, even over rows — every one of them holds NULL", () => {
        const existing = existingPeople(true);
        expect(addColumnSql(existing, people(handle), "handle")).toBe(
            'ALTER TABLE "public"."people" ADD COLUMN IF NOT EXISTS "handle" TEXT UNIQUE;');
        expect(planCollectionSchemaEnsure([people(handle)], existing).withheldConstraints).toEqual([]);
    });

    it("is UNIQUE with its default on a table that holds no rows", () => {
        const existing = existingPeople(false);
        expect(addColumnSql(existing, people(tier), "tier")).toBe(
            'ALTER TABLE "public"."people" ADD COLUMN IF NOT EXISTS "tier" TEXT UNIQUE DEFAULT \'free\';');
        expect(planCollectionSchemaEnsure([people(tier)], existing).withheldConstraints).toEqual([]);
    });

    it("is withheld, and reported, when a default would give every existing row the same value", () => {
        for (const populated of [true, undefined]) {
            const existing = existingPeople(populated);
            expect(addColumnSql(existing, people(tier), "tier")).toBe(
                'ALTER TABLE "public"."people" ADD COLUMN IF NOT EXISTS "tier" TEXT DEFAULT \'free\';');
            const withheld = planCollectionSchemaEnsure([people(tier)], existing).withheldConstraints;
            expect(withheld).toHaveLength(1);
            expect(withheld[0]).toMatchObject({ target: "public.people.tier", kind: "unique" });
            expect(withheld[0].reason).toMatch(/"free"|default/);
        }
    });

    it("leaves a column that is already there alone", () => {
        const existing: ExistingSchema = {
            ...existingPeople(true),
            tables: new Map([["public.people", new Set(["id", "name", "handle"])]])
        };
        const plan = planCollectionSchemaEnsure([people(handle)], existing);
        expect(plan.actions.filter(a => a.target.startsWith("public.people.handle"))).toEqual([]);
        expect(plan.withheldConstraints).toEqual([]);
    });

    it("holds on a live database: duplicates are refused and an upsert on the column works", async () => {
        const db = new PGlite();
        try {
            await ensureCollectionTables(asQueryable(db), [people()]);
            await db.exec("INSERT INTO public.people (name) VALUES ('Ada'), ('Grace');");

            const outcome = await ensureCollectionTables(asQueryable(db), [people(handle)]);
            expect(outcome.failures).toEqual([]);

            await db.exec("INSERT INTO public.people (name, handle) VALUES ('Alan', 'alan');");
            await expect(db.exec("INSERT INTO public.people (name, handle) VALUES ('Other', 'alan');"))
                .rejects.toThrow(/duplicate key/);
            await db.exec(
                "INSERT INTO public.people (name, handle) VALUES ('Alan T.', 'alan') " +
                "ON CONFLICT (handle) DO UPDATE SET name = EXCLUDED.name;");
            const { rows } = await db.query<{ name: string }>("SELECT name FROM public.people WHERE handle = 'alan'");
            expect(rows).toEqual([{ name: "Alan T." }]);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("says so at boot when it is withheld, and the boot still succeeds", async () => {
        const db = new PGlite();
        try {
            await ensureCollectionTables(asQueryable(db), [people()]);
            await db.exec("INSERT INTO public.people (name) VALUES ('Ada'), ('Grace');");

            const said: string[] = [];
            const outcome = await ensureCollectionTables(asQueryable(db), [people(tier)], m => said.push(m));
            expect(outcome.failures).toEqual([]);
            expect(said.some(m => m.startsWith('No UNIQUE on "public.people.tier"'))).toBe(true);

            const existing = await readExistingSchema(asQueryable(db), ["public"]);
            expect(existing.tables.get("public.people")?.has("tier")).toBe(true);
        } finally {
            await db.close();
        }
    }, 30_000);
});
