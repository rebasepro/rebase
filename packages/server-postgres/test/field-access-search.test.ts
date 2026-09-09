/**
 * A field the caller cannot read is not one they may search.
 *
 * The row strip keeps the value out of the response; the fallback ILIKE search
 * OR-ed a `%term%` across *every* string property, so the same value was still
 * recoverable a substring at a time by watching which searches returned the row.
 * That is the disclosure the read rule exists to prevent, reached through a
 * parameter that names no field at all — which is why the refusal in the query
 * parser cannot catch it and the condition builder has to.
 *
 * The declared `search` block has no such fix available: it compiles to one
 * generated `tsvector` shared by every caller. `checkSearchFieldsAreReadable` in
 * `validate-config.ts` refuses that combination at boot instead.
 */
import { CollectionConfig } from "@rebasepro/types";
import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";
import { withFieldViewer } from "../src/services/field-viewer";

const staff = pgTable("staff", {
    id: serial("id").primaryKey(),
    name: text("name"),
    notes: text("notes"),
    password_hash: text("password_hash"),
    age: integer("age")
});

const collection: CollectionConfig = {
    slug: "staff",
    name: "Staff",
    table: "staff",
    properties: {
        id: { type: "number", isId: true },
        name: { type: "string" },
        notes: { type: "string", access: { read: ["hr"] } },
        passwordHash: { type: "string", columnName: "password_hash", excludeFromApi: true },
        age: { type: "number" }
    },
    idField: "id"
};

const conditionCount = (roles?: string[]): number =>
    (roles
        ? withFieldViewer({ roles }, () =>
            DrizzleConditionBuilder.buildSearchConditions("ada", collection.properties, staff, collection))
        : DrizzleConditionBuilder.buildSearchConditions("ada", collection.properties, staff, collection)
    ).length;

describe("the fallback ILIKE search", () => {
    it("searches only the readable string columns for a caller without the role", () => {
        // `name` only — not `notes`, not `password_hash`.
        expect(conditionCount(["staff"])).toBe(1);
    });

    it("searches the restricted one too for a caller holding the role", () => {
        expect(conditionCount(["hr"])).toBe(2);
    });

    it("searches it for `admin`, who satisfies any non-empty list", () => {
        expect(conditionCount(["admin"])).toBe(2);
    });

    it("never searches an `excludeFromApi` column, whoever is asking", () => {
        // Two is `name` + `notes`. A third would be `password_hash`, and the
        // whole point of the flag is that no caller reaches it.
        expect(conditionCount(["admin"])).toBe(2);
        expect(conditionCount(["hr"])).toBe(2);
    });

    it("searches everything but the excluded column on the trusted server plane", () => {
        expect(conditionCount()).toBe(2);
    });
});
