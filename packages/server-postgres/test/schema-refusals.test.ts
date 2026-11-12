/**
 * The configurations that have no correct column, refused by every emitter.
 *
 * Each of these used to produce something: a type nothing creates, a table
 * Postgres will not accept, a default that calls a function nobody wrote, a
 * column silently missing. Two of the three were fatal at boot on a managed
 * tenant, where there is no developer to read the error — and the third was
 * worse, because it succeeded.
 *
 * Refusing in one place is the point — and it is now literally one place:
 * `planSchema` reads the collections and every renderer works from what it
 * produced, so a path that forgets to check cannot be the path that ships the
 * broken schema.
 */
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import { planCollectionSchemaEnsure, type ExistingSchema } from "../src/schema/ensure-collection-tables";
import {
    companies,
    companyTranslations,
    linkIntoComposite,
    refused,
    strEnumRec,
    numEnumRec
} from "./fixtures/property-matrix-collections";
import type { CollectionConfig } from "@rebasepro/types";
import { compileSet, PLAN_REFUSAL_ALLOWED_MESSAGES } from "./helpers/plan-tables";

const emptyDb = (): ExistingSchema => ({ tables: new Map(), enums: new Set(), constraints: new Set() });

describe("a configuration with no correct column is refused by all three emitters", () => {
    for (const { collection, because: legacyBecause } of refused) {
        // Refused before the planner now, in the table model's words where the message moved.
        const because = PLAN_REFUSAL_ALLOWED_MESSAGES.find(moved => moved.id === `property-matrix.${collection.slug}`)?.pattern ?? legacyBecause;
        it(`${collection.slug}`, () => {
            expect(() => generateSchema(compileSet([collection]))).toThrow(because);
            expect(() => generatePostgresDdl(compileSet([collection]))).toThrow(because);
            expect(() => planCollectionSchemaEnsure(compileSet([collection]), emptyDb())).toThrow(because);
        });

        it(`${collection.slug} — the message names the collection and the property`, () => {
            expect(() => generateSchema(compileSet([collection]))).toThrow(collection.slug!);
        });
    }
});

describe("a foreign key into a composite primary key is refused by all three emitters", () => {
    // A foreign key is one column; `REFERENCES company_translations (id)`
    // against the key `(id, locale)` is refused by Postgres, because `id` alone
    // is not unique. The composite key itself is fine — it is the link into it
    // that has no column to point at.
    const collections = [companies, companyTranslations, linkIntoComposite];
    // Refused by `compileTables` now, before the planner (see PLAN_REFUSAL_ALLOWED_MESSAGES).
    const because = /one column cannot reference a composite key/;

    it("naming the link and the key it cannot reference", () => {
        expect(() => generateSchema(compileSet(collections))).toThrow(because);
        expect(() => generatePostgresDdl(compileSet(collections))).toThrow(because);
        expect(() => planCollectionSchemaEnsure(compileSet(collections), emptyDb())).toThrow(because);
    });

    it("while the composite key without the link is emitted by all three", () => {
        const accepted = [companies, companyTranslations];
        expect(() => generateSchema(compileSet(accepted))).not.toThrow();
        expect(() => generatePostgresDdl(compileSet(accepted))).not.toThrow();
        expect(() => planCollectionSchemaEnsure(compileSet(accepted), emptyDb())).not.toThrow();
    });
});

describe("the record form of an enum is read, not thrown on", () => {
    // `EnumValues` is `EnumValueConfig[] | Record<id, label>` and the docs
    // recommend the record. Boot-ensure walked `(p.enum as unknown[]).map`, so
    // the recommended form threw `p.enum.map is not a function` — at boot, on a
    // managed tenant, fatally. The other two emitters read both forms, which is
    // exactly why nobody noticed.
    const collections: CollectionConfig[] = [strEnumRec, numEnumRec];

    it("by boot-ensure, which is where it crashed", () => {
        const plan = planCollectionSchemaEnsure(compileSet(collections), emptyDb());
        const enumAction = plan.actions.find(a => a.kind === "create-enum");
        expect(enumAction!.sql).toContain("CREATE TYPE \"public\".\"str_enum_rec_enum_rec\" AS ENUM ('x', 'y');");
    });

    it("and by the two generators, in the same order", async () => {
        expect(await generatePostgresDdl(compileSet(collections)))
            .toContain("CREATE TYPE \"public\".\"str_enum_rec_enum_rec\" AS ENUM ('x', 'y');");
        expect(await generateSchema(compileSet(collections)))
            .toContain("pgEnum(\"str_enum_rec_enum_rec\", [\"x\", \"y\"])");
    });

    it("and a number enum still creates no type at all", async () => {
        // Its column is NUMERIC or INTEGER on every path, so the type all three
        // used to create was referenced by nothing.
        const plan = planCollectionSchemaEnsure(compileSet([numEnumRec]), emptyDb());
        expect(plan.actions.filter(a => a.kind === "create-enum")).toEqual([]);
        expect(await generatePostgresDdl(compileSet([numEnumRec]))).not.toContain("CREATE TYPE");
        expect(await generateSchema(compileSet([numEnumRec]))).not.toContain("pgEnum(");
    });
});
