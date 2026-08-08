/**
 * The default search must not depend on which copy of `drizzle-orm` built the
 * table.
 *
 * `buildSearchConditions` used to decide whether a column could be matched with
 * `ILIKE` by testing `column instanceof PgVarchar | PgText | PgChar`.
 * `instanceof` is class identity, so it silently answers "no" for a column
 * constructed by a *different instance of the same module* — which is what an
 * application gets whenever its own `drizzle-orm` range and the driver's do not
 * overlap and the installer resolves two copies.
 *
 * The consequence was not a crash. No condition was produced, the caller turned
 * the empty list into an impossible `WHERE`, and every search on every
 * collection without a `search` block answered 200 with an empty page — so the
 * breakage was indistinguishable from "nothing matched". Found in a deployed
 * app whose backend pinned `drizzle-orm@^0.44` against a driver asking for
 * `^0.45`: searching a users collection for `francesco` returned nothing while
 * `email ILIKE '%francesco%'` returned the row in psql.
 *
 * The test forges the condition rather than installing a second drizzle: a
 * column object that reports `varchar` from `getSQLType()` but is an instance of
 * nothing this module imported is exactly what the second copy hands over.
 */
import { CollectionConfig } from "@rebasepro/types";
import { pgTable, PgDialect, uuid, varchar, text } from "drizzle-orm/pg-core";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";

const users = pgTable("users", {
    id: uuid("id").primaryKey(),
    email: varchar("email").notNull(),
    displayName: varchar("display_name"),
    bio: text("bio")
});

const collection: CollectionConfig = {
    slug: "users",
    name: "Users",
    table: "users",
    idField: "id",
    properties: {
        id: {
            type: "string",
            isId: "uuid"
        },
        email: { type: "string" },
        displayName: {
            type: "string",
            columnName: "display_name"
        },
        bio: { type: "string" }
    }
} as unknown as CollectionConfig;

/** The columns each condition was built against, by SQL identifier. */
const searchedColumns = (table: unknown): string[] => {
    const conditions = DrizzleConditionBuilder.buildSearchConditions(
        "francesco", collection.properties, table as never, collection
    );
    const dialect = new PgDialect();
    return conditions.map(c => dialect.sqlToQuery(c).sql);
};

describe("the ILIKE fallback tests column type, not class identity", () => {
    it("searches every text-bearing column of a normally-built table", () => {
        expect(searchedColumns(users)).toEqual([
            "\"users\".\"email\" ilike $1",
            "\"users\".\"display_name\" ilike $1",
            "\"users\".\"bio\" ilike $1"
        ]);
    });

    it("still searches them when the table came from another module instance", () => {
        // Same columns, re-created so that `instanceof PgVarchar` is false —
        // the shape a duplicate `drizzle-orm` install produces.
        const foreign = Object.fromEntries(
            Object.entries(users).map(([key, column]) => [
                key,
                Object.assign(Object.create(Object.getPrototypeOf(column)), column)
            ])
        );
        // Prototype chain deliberately broken: nothing here is an instance of
        // any class this module imported.
        for (const column of Object.values(foreign)) {
            Object.setPrototypeOf(column as object, {
                getSQLType: (users.email as unknown as { getSQLType: () => string }).getSQLType.bind(column)
            });
        }

        expect(searchedColumns(foreign)).toHaveLength(3);
    });

    it("leaves the uuid primary key out of the search", () => {
        expect(searchedColumns(users).join(" ")).not.toContain("\"id\"");
    });
});
