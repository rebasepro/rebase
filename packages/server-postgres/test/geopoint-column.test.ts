import { col } from "@rebasepro/types";
import { LegacyCollectionConfig, LegacyPostgresProperty } from "@rebasepro/common/migrate";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import { planSchema } from "../src/schema/plan/plan-schema";
import { planColumnFor, planColumnTypeFor } from "./helpers/plan-column";
import { serializeColumnToServer } from "../src/data-transformer";
import { toRestScalar } from "../src/services/row-pipeline";
import { columnOf, runtimeTableOf } from "./helpers/codec-columns";
import { compileSet, planCollections } from "./helpers/plan-tables";

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
    const places: LegacyCollectionConfig = {
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
        const schema = await generateSchema(compileSet([places]));
        expect(schema).toContain("location: jsonb(\"location\")");
    });

    it("puts a JSONB column in the DDL, matching the documented type", async () => {
        const ddl = await generatePostgresDdl(compileSet([places]));
        expect(ddl).toMatch(/"location"\s+JSONB/);
    });

    // The two generators cannot disagree any more: there is one column, decided
    // once, and each of them renders it. This pins the decision itself.
    it("is one jsonb column in the plan both generators render", () => {
        expect(planColumnTypeFor([places], "places", "location")).toBe("JSONB");
    });

    it("round-trips a { latitude, longitude } value", () => {
        const location = runtimeTableOf(places).columnsByKey.get("location");
        if (!location) throw new Error("places compiled without its location column");
        expect(location.semantic).toBe("geopoint");
        const stored = serializeColumnToServer({ latitude: 41.38,
longitude: 2.17 }, location, "location");
        expect(stored).toEqual({ latitude: 41.38,
longitude: 2.17 });
        expect(toRestScalar(stored, location)).toEqual({ latitude: 41.38,
longitude: 2.17 });
    });

    it("rejects a value that is not a geopoint rather than storing a shrug", () => {
        const location = columnOf(col.geopoint());
        expect(() => serializeColumnToServer("41.38,2.17", location, "location"))
            .toThrow(/'location' expects a geopoint object/);
        expect(() => serializeColumnToServer({ lat: 41.38,
lng: 2.17 }, location, "location"))
            .toThrow(/numeric `latitude` and `longitude`/);
        expect(() => serializeColumnToServer([41.38, 2.17], location, "location"))
            .toThrow(/expects a geopoint object/);
    });

    /**
     * The class-21 half of the fix: a property type neither generator maps is a
     * generator bug that has to be loud. `null` meant "no column on this table",
     * which is true of an inverse relation and was silently applied to a type
     * the switch had simply forgotten.
     */
    it("refuses to generate a table for a property type nobody mapped", () => {
        const odd: LegacyCollectionConfig = {
            slug: "odd",
            table: "odd",
            name: "Odd",
            // Deliberately invalid: a property type no engine maps, which the planner must refuse.
            properties: { thing: { type: "quaternion" } as unknown as LegacyPostgresProperty }
        };

        // Once, in the planner, before any renderer is reached.
        expect(() => planCollections([odd]))
            .toThrow(/odd\.thing: is a quaternion property, which has no column of its own/);
    });

    it("still emits no column for a relation that lives on the other table", () => {
        // The legitimate `null`: an inverse relation is a column on the target.
        const authors: LegacyCollectionConfig = {
            slug: "authors",
            table: "authors",
            name: "Authors",
            properties: {
                posts: { type: "relation" }
            },
            relations: [
                {
                    kind: "hasMany",
                    relationName: "posts",
                    target: () => authors,
                    foreignKeyOnTarget: "author_id"
                }
            ]
        };

        expect(planColumnFor([authors], "authors", "posts")).toBeUndefined();
    });
});
