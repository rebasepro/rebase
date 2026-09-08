/**
 * The configurations that have no correct column, refused by every emitter.
 *
 * Each of these used to produce something: a type nothing creates, a table
 * Postgres will not accept, a default that calls a function nobody wrote, a
 * column silently missing. Two of the three were fatal at boot on a managed
 * tenant, where there is no developer to read the error — and the third was
 * worse, because it succeeded.
 *
 * Refusing in one place is the point. `column-plan-helpers` is what all three
 * read, so a path that forgets to check cannot be the path that ships the
 * broken schema.
 */
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import { planCollectionSchemaEnsure, type ExistingSchema } from "../src/schema/ensure-collection-tables";
import { refused, strEnumRec, numEnumRec } from "./fixtures/property-matrix-collections";
import type { CollectionConfig } from "@rebasepro/types";

const emptyDb = (): ExistingSchema => ({ tables: new Map(), enums: new Set(), constraints: new Set() });

describe("a configuration with no correct column is refused by all three emitters", () => {
    for (const { collection, because } of refused) {
        it(`${collection.slug}`, async () => {
            await expect(generateSchema([collection])).rejects.toThrow(because);
            await expect(generatePostgresDdl([collection])).rejects.toThrow(because);
            expect(() => planCollectionSchemaEnsure([collection], emptyDb())).toThrow(because);
        });

        it(`${collection.slug} — the message names the collection and the property`, async () => {
            const error = await generateSchema([collection]).catch((e: Error) => e);
            expect((error as Error).message).toContain(collection.slug!);
        });
    }
});

describe("the record form of an enum is read, not thrown on", () => {
    // `EnumValues` is `EnumValueConfig[] | Record<id, label>` and the docs
    // recommend the record. Boot-ensure walked `(p.enum as unknown[]).map`, so
    // the recommended form threw `p.enum.map is not a function` — at boot, on a
    // managed tenant, fatally. The other two emitters read both forms, which is
    // exactly why nobody noticed.
    const collections: CollectionConfig[] = [strEnumRec, numEnumRec];

    it("by boot-ensure, which is where it crashed", () => {
        const plan = planCollectionSchemaEnsure(collections, emptyDb());
        const enumAction = plan.actions.find(a => a.kind === "create-enum");
        expect(enumAction!.sql).toContain("CREATE TYPE \"public\".\"str_enum_rec_enum_rec\" AS ENUM ('x', 'y');");
    });

    it("and by the two generators, in the same order", async () => {
        expect(await generatePostgresDdl(collections))
            .toContain("CREATE TYPE \"public\".\"str_enum_rec_enum_rec\" AS ENUM ('x', 'y');");
        expect(await generateSchema(collections))
            .toContain("pgEnum(\"str_enum_rec_enum_rec\", [\"x\", \"y\"])");
    });

    it("and a number enum still creates no type at all", async () => {
        // Its column is NUMERIC or INTEGER on every path, so the type all three
        // used to create was referenced by nothing.
        const plan = planCollectionSchemaEnsure([numEnumRec], emptyDb());
        expect(plan.actions.filter(a => a.kind === "create-enum")).toEqual([]);
        expect(await generatePostgresDdl([numEnumRec])).not.toContain("CREATE TYPE");
        expect(await generateSchema([numEnumRec])).not.toContain("pgEnum(");
    });
});
