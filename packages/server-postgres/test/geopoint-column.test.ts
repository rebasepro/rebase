import { CollectionConfig, Property } from "@rebasepro/types";
import { generateSchema, getDrizzleColumn } from "../src/schema/generate-drizzle-schema-logic";
import { generatePostgresDdl, getSqlColumnType } from "../src/schema/generate-postgres-ddl-logic";
import { serializePropertyToServer, parsePropertyFromServer } from "../src/data-transformer";

/**
 * `geopoint` was a first-class property type — in `DataType`, allowed by config
 * validation, given an OpenAPI object schema, a generated TS type, an admin
 * field binding and a docs row promising `jsonb` — that Postgres could not
 * store. The DDL generator fell through to `TEXT` while the Drizzle generator
 * fell through to `null`, and a `null` column was dropped without a warning, so
 * Drizzle built every INSERT from a column list that had no key for it. Writes
 * answered 201 and stored nothing, forever.
 */
describe("geopoint columns", () => {
    const places: CollectionConfig = {
        slug: "places",
        table: "places",
        name: "Places",
        properties: {
            name: { type: "string" },
            location: { type: "geopoint",
name: "Location" }
        }
    };

    it("puts a jsonb column on the Drizzle table", async () => {
        const schema = await generateSchema([places]);
        expect(schema).toContain("location: jsonb(\"location\")");
    });

    it("puts a JSONB column in the DDL, matching the documented type", async () => {
        const ddl = await generatePostgresDdl([places]);
        expect(ddl).toMatch(/"location"\s+JSONB/);
    });

    it("agrees between the two generators", () => {
        const prop = places.properties.location as Property;
        expect(getDrizzleColumn("location", prop, places, [places])).toContain("jsonb");
        expect(getSqlColumnType("location", prop, places, [places])).toBe("JSONB");
    });

    it("round-trips a { latitude, longitude } value", () => {
        const prop = places.properties.location as Property;
        const stored = serializePropertyToServer({ latitude: 41.38,
longitude: 2.17 }, prop, "location");
        expect(stored).toEqual({ latitude: 41.38,
longitude: 2.17 });
        expect(parsePropertyFromServer(stored, prop, places, "location")).toEqual({ latitude: 41.38,
longitude: 2.17 });
    });

    it("rejects a value that is not a geopoint rather than storing a shrug", () => {
        const prop = places.properties.location as Property;
        expect(() => serializePropertyToServer("41.38,2.17", prop, "location"))
            .toThrow(/'location' expects a geopoint object/);
        expect(() => serializePropertyToServer({ lat: 41.38,
lng: 2.17 }, prop, "location"))
            .toThrow(/numeric `latitude` and `longitude`/);
    });

    /**
     * The class-21 half of the fix: a property type neither generator maps is a
     * generator bug that has to be loud. `null` meant "no column on this table",
     * which is true of an inverse relation and was silently applied to a type
     * the switch had simply forgotten.
     */
    it("refuses to generate a table for a property type nobody mapped", () => {
        const odd = {
            slug: "odd",
            table: "odd",
            name: "Odd",
            properties: { thing: { type: "quaternion" } }
        } as unknown as CollectionConfig;

        expect(() => getDrizzleColumn("thing", odd.properties.thing as Property, odd, [odd]))
            .toThrow(/No Postgres column mapping for property 'thing' of type 'quaternion'/);
        expect(() => getSqlColumnType("thing", odd.properties.thing as Property, odd, [odd]))
            .toThrow(/No Postgres column type for property 'thing' of type 'quaternion'/);
    });

    it("still emits no column for a relation that lives on the other table", () => {
        // The legitimate `null`: an inverse relation is a column on the target.
        const authors: CollectionConfig = {
            slug: "authors",
            table: "authors",
            name: "Authors",
            properties: {
                posts: { type: "relation",
relationName: "posts" }
            },
            relations: [
                {
                    kind: "hasMany",
                    relationName: "posts",
                    target: () => authors,
                    foreignKeyOnTarget: "author_id"
                }
            ]
        } as unknown as CollectionConfig;

        expect(getDrizzleColumn("posts", authors.properties.posts as Property, authors, [authors])).toBeNull();
    });
});
