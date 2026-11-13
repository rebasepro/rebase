/**
 * A junction's primary key does not depend on which collection was planned first.
 *
 * When both ends of a many-to-many declare it, the junction is planned from
 * whichever declaring side the planner reached first. `db push` loads collection
 * files in filename order and boot plans the bundle's `collections` array, so
 * the two doors built `categories_people` as `(category_id, person_id)` and
 * `(person_id, category_id)` — and every boot-provisioned database got its
 * junction key rebuilt (an ACCESS EXCLUSIVE lock and a full index rebuild) on
 * its first `db push`.
 *
 * The rule now: with one declaring side, that side is the source, as it always
 * was — so no single-sided junction in the field changes. With two, the side
 * whose table name sorts first, which is the order `db push` already used for
 * files named after their tables.
 */
import type { LegacyCollectionConfig, LegacyPostgresCollectionConfig } from "@rebasepro/common/migrate";
import { planSchema } from "../src/schema/plan/plan-schema";
import { planCollections } from "./helpers/plan-tables";

const people: LegacyPostgresCollectionConfig = {
    slug: "people",
    table: "people",
    name: "People",
    properties: {
        id: { type: "string", isId: "uuid" },
        categories: { type: "relation", relation: { kind: "manyToMany", target: () => categories } }
    }
};

const categories: LegacyCollectionConfig = {
    slug: "categories",
    table: "categories",
    name: "Categories",
    properties: {
        id: { type: "number", isId: "increment" },
        people: { type: "relation", relation: { kind: "manyToMany", target: () => people } }
    }
};

const junctionOf = (collections: LegacyCollectionConfig[]) => {
    const junction = planCollections(collections).tables.find(t => t.kind === "junction");
    if (!junction) throw new Error("no junction planned");
    return { primaryKey: junction.primaryKey, columns: junction.columns.map(c => `${c.column} ${c.type.kind}`) };
};

describe("a junction both ends declare", () => {
    it("is keyed the same whichever collection is planned first", () => {
        expect(junctionOf([people, categories])).toEqual(junctionOf([categories, people]));
    });

    it("is keyed from the side whose table sorts first", () => {
        expect(junctionOf([people, categories]).primaryKey).toEqual(["category_id", "person_id"]);
    });
});

describe("a junction one end declares", () => {
    it("keeps the declaring side as the source, as it always was", () => {
        const onlyPeople: LegacyPostgresCollectionConfig = {
            ...people,
            properties: { ...people.properties }
        };
        const plainCategories: LegacyCollectionConfig = {
            slug: "categories",
            table: "categories",
            name: "Categories",
            properties: { id: { type: "number", isId: "increment" } }
        };
        const declared: LegacyCollectionConfig = {
            ...onlyPeople,
            properties: {
                id: { type: "string", isId: "uuid" },
                categories: { type: "relation", relation: { kind: "manyToMany", target: () => plainCategories } }
            }
        };
        expect(junctionOf([plainCategories, declared]).primaryKey).toEqual(["person_id", "category_id"]);
        expect(junctionOf([declared, plainCategories]).primaryKey).toEqual(["person_id", "category_id"]);
    });
});
