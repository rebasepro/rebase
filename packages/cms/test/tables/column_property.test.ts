/**
 * Every column type picks a property an existing field renders. The widget is
 * asserted through `getDefaultFieldId` — the function the form itself uses —
 * so a projection that names the wrong facts fails here, not in a browser.
 */
import { describe, expect, it } from "@jest/globals";
import type { ColumnDescriptor, ColumnType } from "@rebasepro/types";
import type { Property } from "@rebasepro/cms-types";
import { getColorSchemeForKey, getColorSchemeForSeed } from "@rebasepro/ui";
import { isReadOnly } from "@rebasepro/app";
import { getDefaultFieldId } from "../../src/components/field_ids";
import { enumValueColor, propertyFromColumn } from "../../src/tables";
import { column } from "./fixtures";

const project = (c: ColumnDescriptor, primaryKey: string[] = [], tenantField?: string): Property => {
    const property = propertyFromColumn(c, { primaryKey, tenantField });
    if (!property) throw new Error(`${c.key} projected to nothing`);
    return property;
};

const widget = (type: ColumnType, facts: Partial<ColumnDescriptor> = {}) => getDefaultFieldId(project(column("value", type, facts)));

describe("widget per column type", () => {
    it.each<[string, ColumnType, Partial<ColumnDescriptor>, string]>([
        ["text", { kind: "text" }, {}, "text_field"],
        ["varchar", { kind: "varchar", length: 80 }, {}, "text_field"],
        ["char", { kind: "char", length: 2 }, {}, "text_field"],
        ["text with validate.email", { kind: "text" }, { validate: { email: true } }, "email"],
        ["uuid", { kind: "uuid" }, {}, "text_field"],
        ["text .userId()", { kind: "text" }, { semantic: "user" }, "user_select"],
        ["uuid .userId()", { kind: "uuid" }, { semantic: "user" }, "user_select"],
        ["other (inet)", { kind: "other", sqlType: "inet" }, {}, "text_field"],
        ["enum", { kind: "enum", values: ["a", "b"] }, {}, "select"],
        ["text .oneOf()", { kind: "text" }, { oneOf: ["x", "y"] }, "select"],
        ["integer .oneOf()", { kind: "integer" }, { oneOf: [1, 2, 3] }, "number_select"],
        ["smallint", { kind: "smallint" }, {}, "number_input"],
        ["integer", { kind: "integer" }, {}, "number_input"],
        ["bigint", { kind: "bigint" }, {}, "number_input"],
        ["serial", { kind: "serial" }, {}, "number_input"],
        ["real", { kind: "real" }, {}, "number_input"],
        ["double precision", { kind: "doublePrecision" }, {}, "number_input"],
        ["numeric", { kind: "numeric", precision: 10, scale: 2 }, {}, "number_input"],
        ["boolean", { kind: "boolean" }, {}, "switch"],
        ["timestamptz", { kind: "timestamptz" }, {}, "date_time"],
        ["date", { kind: "date" }, {}, "date_time"],
        ["time", { kind: "time" }, {}, "date_time"],
        ["jsonb without a shape", { kind: "jsonb" }, {}, "key_value"],
        ["json without a shape", { kind: "json" }, {}, "key_value"],
        ["jsonb geopoint", { kind: "jsonb" }, { semantic: "geopoint" }, "geopoint"],
        ["storage", { kind: "text" }, { storage: { path: "files/" } }, "file_upload"],
        ["vector", { kind: "vector", dimensions: 3 }, {}, "vector_input"],
        ["bytea", { kind: "bytea" }, {}, "binary"],
        ["text[]", { kind: "array", of: { kind: "text" } }, {}, "repeat"],
        ["integer[]", { kind: "array", of: { kind: "integer" } }, {}, "repeat"],
        ["text[] .oneOf()", { kind: "array", of: { kind: "text" } }, { element: { oneOf: ["a", "b"] } }, "multi_select"],
        ["integer[] .oneOf()", { kind: "array", of: { kind: "integer" } }, { element: { oneOf: [1, 2] } }, "multi_number_select"],
        ["enum[]", { kind: "array", of: { kind: "enum", values: ["a", "b"] } }, {}, "multi_select"],
        ["storage .multiple()", { kind: "array", of: { kind: "text" } }, { storage: { path: "files/" } }, "multi_file_upload"],
        ["array of storage", { kind: "array", of: { kind: "text" } }, { element: { storage: { path: "files/" } } }, "multi_file_upload"]
    ])("%s → %s", (_label, type, facts, expected) => {
        expect(widget(type, facts)).toBe(expected);
    });
});

describe("what each type states", () => {
    it("text keeps its column type, and a varchar its length as the max", () => {
        expect(project(column("a", { kind: "text" }))).toMatchObject({ type: "string", columnType: "text" });
        expect(project(column("a", { kind: "varchar", length: 160 }))).toMatchObject({ columnType: "varchar", validation: { max: 160 } });
        expect(project(column("a", { kind: "uuid" }))).toMatchObject({ type: "string", columnType: "uuid" });
    });

    it("a user's id is the user picker, on the column, on each array item and inside a JSON document", () => {
        expect(project(column("owner", { kind: "uuid" }, { semantic: "user" }))).toMatchObject({ type: "string", columnType: "uuid", userSelect: true });
        expect(project(column("owner", { kind: "text" }))).not.toHaveProperty("userSelect");
        expect(project(column("watchers", { kind: "array", of: { kind: "text" } }, { element: { semantic: "user" } })))
            .toMatchObject({ type: "array", of: { type: "string", userSelect: true } });
        expect(project(column("doc", { kind: "jsonb" }, { json: { kind: "object", fields: { approver: { kind: "string", semantic: "user" } } } })))
            .toMatchObject({ type: "map", properties: { approver: { type: "string", userSelect: true } } });
    });

    it("validate.url is the URL input", () => {
        expect(project(column("site", { kind: "text" }, { validate: { url: true } }))).toMatchObject({ url: true });
    });

    it("string rules carry over, a flagged pattern as a RegExp", () => {
        const property = project(column("code", { kind: "text" }, {
            validate: { min: 2, max: 8, length: 6, matches: "^[a-z]+$", matchesFlags: "i", matchesMessage: "letters", trim: true, lowercase: true }
        }));
        expect(property.validation).toEqual({ min: 2, max: 8, length: 6, matches: /^[a-z]+$/i, matchesMessage: "letters", trim: true, lowercase: true });
    });

    it("integer kinds validate as integers; numeric keeps precision and scale", () => {
        expect(project(column("n", { kind: "integer" }, { validate: { min: 0, max: 10 } })))
            .toMatchObject({ type: "number", columnType: "integer", validation: { min: 0, max: 10, integer: true } });
        expect(project(column("n", { kind: "smallint" }))).toMatchObject({ columnType: "integer", validation: { integer: true } });
        expect(project(column("n", { kind: "bigserial" }))).toMatchObject({ columnType: "bigserial" });
        expect(project(column("n", { kind: "numeric", precision: 10, scale: 2 }, { validate: { positive: true, lessThan: 100 } })))
            .toEqual({ type: "number", name: "N", columnType: "numeric", precision: 10, scale: 2, validation: { positive: true, lessThan: 100 } });
        expect(project(column("n", { kind: "doublePrecision" }))).toMatchObject({ columnType: "double precision" });
    });

    it("temporal kinds pick the date-time, date and time pickers", () => {
        expect(project(column("at", { kind: "timestamptz" }))).toMatchObject({ type: "date", columnType: "timestamp", mode: "date_time" });
        expect(project(column("on", { kind: "date" }))).toMatchObject({ type: "date", columnType: "date", mode: "date" });
        expect(project(column("time", { kind: "time" }))).toMatchObject({ type: "date", columnType: "time" });
    });

    it("date bounds become Dates", () => {
        expect(project(column("at", { kind: "date" }, { validate: { min: "2020-01-01", max: "2030-01-01" } })).validation)
            .toEqual({ min: new Date("2020-01-01"), max: new Date("2030-01-01") });
    });

    it("storage becomes the upload field's configuration", () => {
        const property = project(column("hero", { kind: "text" }, {
            storage: { source: "media", path: "posts/heroes/", accept: ["image/*"], maxBytes: 1024, imageResize: { maxWidth: 800 }, public: true, fileName: "{rand}", storeUrl: true }
        }));
        expect(property).toMatchObject({
            type: "string",
            storage: { storageSource: "media", storagePath: "posts/heroes/", acceptedFiles: ["image/*"], maxSize: 1024, imageResize: { maxWidth: 800 }, public: true, fileName: "{rand}", storeUrl: true }
        });
    });

    it("arrays carry item rules and minItems/maxItems/uniqueItems", () => {
        const property = project(column("labels", { kind: "array", of: { kind: "varchar", length: 20 } }, {
            validate: { minItems: 1, maxItems: 5, uniqueItems: true },
            element: { validate: { min: 2 } }
        }));
        expect(property).toEqual({
            type: "array",
            name: "Labels",
            columnType: "text[]",
            of: { type: "string", columnType: "varchar", validation: { min: 2, max: 20 } },
            validation: { min: 1, max: 5, uniqueInArray: true }
        });
        expect(project(column("flags", { kind: "array", of: { kind: "boolean" } }))).toMatchObject({ columnType: "boolean[]", of: { type: "boolean" } });
        expect(project(column("at", { kind: "array", of: { kind: "timestamptz" } }))).toMatchObject({ of: { type: "date", mode: "date_time" } });
    });

    it("vector keeps its dimensions and index; ip is the inner product", () => {
        expect(project(column("e", { kind: "vector", dimensions: 3 }, { vectorIndex: { method: "hnsw", metric: ["cosine", "ip"], m: 16 } })))
            .toMatchObject({ type: "vector", dimensions: 3, index: { method: "hnsw", distance: ["cosine", "inner_product"], m: 16 } });
        expect(project(column("e", { kind: "vector", dimensions: 3 }, { vectorIndex: false }))).toMatchObject({ index: false });
    });

    it("jsonb without a shape keeps its column type", () => {
        expect(project(column("meta", { kind: "jsonb" }))).toEqual({ type: "map", name: "Meta", columnType: "jsonb", keyValue: true });
    });
});

describe("enum options", () => {
    it("labels each value and gives it a chip colour", () => {
        const property = project(column("status", { kind: "enum", values: ["draft", "needs_review"] }));
        expect(property).toMatchObject({
            type: "string",
            enum: [
                { id: "draft", label: "Draft", color: enumValueColor("draft") },
                { id: "needs_review", label: "Needs Review", color: enumValueColor("needs_review") }
            ]
        });
    });

    it("draws the colour the chip kit draws for the value on its own", () => {
        for (const value of ["draft", "published", "archived", "x", "42"]) {
            const key = enumValueColor(value);
            expect(typeof key).toBe("string");
            if (typeof key !== "string") continue;
            expect(getColorSchemeForKey(key)).toBe(getColorSchemeForSeed(value));
        }
    });

    it("gives a value the same colour whatever its siblings and position", () => {
        const one = project(column("s", { kind: "enum", values: ["published", "draft"] }));
        const two = project(column("s", { kind: "enum", values: ["archived", "draft", "zzz", "published"] }));
        const colorOf = (p: Property, id: string) =>
            p.type === "string" && Array.isArray(p.enum) ? p.enum.find(e => e.id === id)?.color : undefined;
        expect(colorOf(one, "draft")).toBe(colorOf(two, "draft"));
        expect(colorOf(one, "published")).toBe(colorOf(two, "published"));
    });

    it("labels number options by their value", () => {
        expect(project(column("n", { kind: "integer" }, { oneOf: [1, 2] }))).toMatchObject({ enum: [{ id: 1, label: "1" }, { id: 2, label: "2" }] });
    });
});

describe("column facts → form behaviour", () => {
    it("NOT NULL is required, with its message", () => {
        expect(project(column("title", { kind: "text" }, { nullable: false, validate: { requiredMessage: "Give it a title" } })).validation)
            .toEqual({ required: true, requiredMessage: "Give it a title" });
        expect(project(column("title", { kind: "text" })).validation).toBeUndefined();
    });

    it("a literal default opens the form with the value, still required on edit", () => {
        expect(project(column("status", { kind: "enum", values: ["draft", "live"] }, { nullable: false, default: { kind: "literal", value: "draft" } })))
            .toMatchObject({ defaultValue: "draft", validation: { required: true } });
        expect(project(column("n", { kind: "integer" }, { default: { kind: "literal", value: 0 } }))).toMatchObject({ defaultValue: 0 });
        expect(project(column("on", { kind: "boolean" }, { default: { kind: "literal", value: true } }))).toMatchObject({ defaultValue: true });
        expect(project(column("meta", { kind: "jsonb" }, { default: { kind: "literal", value: { a: 1 } } }))).toMatchObject({ defaultValue: { a: 1 } });
    });

    it("a literal default outside the enum is not offered", () => {
        expect(project(column("s", { kind: "enum", values: ["a"] }, { default: { kind: "literal", value: "zz" } }))).not.toHaveProperty("defaultValue");
    });

    it("an expression default lets a create leave the column out", () => {
        expect(project(column("code", { kind: "text" }, { nullable: false, default: { kind: "sql", expression: "gen_short_id()" } })))
            .toMatchObject({ databaseDefault: "sql`gen_short_id()`", validation: { required: true } });
        expect(project(column("code", { kind: "text" }, { nullable: false, default: { kind: "database" } }))).toMatchObject({ databaseDefault: true });
        expect(project(column("ref", { kind: "uuid" }, { default: { kind: "random-uuid" } }))).toMatchObject({ databaseDefault: true });
    });

    it("a defaulted uuid key is a generated id, read-only and not required", () => {
        const property = project(column("id", { kind: "uuid" }, { nullable: false, primaryKey: true, default: { kind: "random-uuid" } }), ["id"]);
        expect(property).toEqual({ type: "string", name: "ID", columnType: "uuid", isId: "uuid" });
    });

    it("identity and serial keys increment; an undefaulted key is typed in", () => {
        expect(project(column("id", { kind: "bigint" }, { nullable: false, default: { kind: "identity" } }), ["id"])).toMatchObject({ isId: "increment" });
        expect(project(column("id", { kind: "serial" }, { nullable: false }), ["id"])).toMatchObject({ isId: "increment" });
        expect(project(column("code", { kind: "text" }, { nullable: false }), ["code"])).toMatchObject({ isId: "manual", validation: { required: true } });
        expect(project(column("id", { kind: "text" }, { nullable: false, default: { kind: "sql", expression: "gen_id()" } }), ["id"])).toMatchObject({ isId: true });
    });

    it("readOnly and generated columns are read-only and never required", () => {
        const readOnly = project(column("score", { kind: "integer" }, { nullable: false, readOnly: true }));
        expect(readOnly.admin?.readOnly).toBe(true);
        expect(readOnly.validation).toEqual({ integer: true });
        const generated = project(column("total", { kind: "numeric" }, { nullable: false, generated: { expression: "a + b" } }));
        expect(isReadOnly(generated)).toBe(true);
        expect(generated.validation).toBeUndefined();
    });

    it("time stamps are audit dates: read-only and out of the default table columns", () => {
        for (const on of ["create", "update"] as const) {
            const property = project(column("at", { kind: "timestamptz" }, { nullable: false, stamp: { on, value: "now" } }));
            expect(property).toMatchObject({
                type: "date",
                autoValue: on === "create" ? "on_create" : "on_update",
                admin: { readOnly: true, hideFromCollection: true }
            });
            expect(property.validation).toBeUndefined();
            expect(isReadOnly(property)).toBe(true);
        }
    });

    it("user stamps are read-only and stay in the table", () => {
        const property = project(column("createdBy", { kind: "uuid" }, { stamp: { on: "create", value: "user" } }));
        expect(property).toMatchObject({ autoValue: "user_on_create", admin: { readOnly: true } });
        expect(property.admin?.hideFromCollection).toBeUndefined();
    });

    it("a private column never reaches the panel", () => {
        expect(propertyFromColumn(column("passwordHash", { kind: "text" }, { private: true }), { primaryKey: [] })).toBeUndefined();
    });

    it("carries access, description and unique", () => {
        expect(project(column("salary", { kind: "integer" }, { access: { read: ["hr"], write: ["hr"] }, description: "Gross, yearly", unique: true })))
            .toMatchObject({ access: { read: ["hr"], write: ["hr"] }, description: "Gross, yearly", validation: { unique: true } });
    });

    it("keeps the SQL name beside a key that differs from it", () => {
        expect(project(column("displayName", { kind: "text" }))).toMatchObject({ columnName: "display_name" });
        expect(project(column("title", { kind: "text" }))).not.toHaveProperty("columnName");
    });

    it("the tenant column is filled by the server and stays among the table columns", () => {
        const property = project(column("orgId", { kind: "uuid" }, { nullable: false }), [], "orgId");
        expect(property).toMatchObject({ validation: { required: true }, admin: { filledByServer: true } });
        expect(property.admin?.hideFromCollection).toBeUndefined();
        expect(property.admin?.readOnly).toBeUndefined();
    });
});
