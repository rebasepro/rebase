/**
 * The driver's field access, read from the table descriptor, withholds at
 * least what the legacy collection path withheld — on every door, for every
 * kind of viewer.
 *
 * The fixtures are the legacy collections of the field-access suites, lifted
 * and compiled through the test helper (what a project upgraded by the codemod
 * runs on). The "old" answer is common's legacy predicate the driver used to
 * call (`restrictedFieldNames`, `apiHiddenFieldNames`, `queryableFieldNames`,
 * `canReadField` and the `type === "string" && !enum && isId !== "uuid"`
 * search choice); the "new" answer is observed from the driver's own
 * functions. For each of read / filter / sort / search / error-message
 * disclosure: old-withheld ⊆ new-withheld.
 *
 * Where the new path withholds more, the difference is pinned too, so a
 * widening shows up here rather than in the field: the derived SQL name of a
 * restricted column (legacy only knew an explicit `columnName`), and a text
 * `.oneOf()` column from search (legacy skipped `enum` likewise; the lift maps
 * an `enum` on a string to a Postgres enum or `.oneOf()`).
 */
import { describe, it, expect } from "@jest/globals";
import { pgTable, text, PgDialect } from "drizzle-orm/pg-core";
import type { TableDescriptor } from "@rebasepro/types";
import type { LegacyCollectionConfig, LegacyProperty } from "@rebasepro/common/migrate";
import { apiHiddenFieldNames, canReadField, defaultUsersCollection, queryableFieldNames, restrictedFieldNames, type FieldViewer } from "@rebasepro/common";

import { stripUnreadable } from "../src/services/row-pipeline";
import { withFieldViewer } from "../src/services/field-viewer";
import { assertReadRequestReadable } from "../src/services/read-field-access";
import { DrizzleConditionBuilder, listedColumnKeys } from "../src/utils/drizzle-conditions";
import { FixtureTableRegistry } from "./helpers/tables";

const bands: LegacyCollectionConfig = {
    name: "Bands", slug: "bands", table: "bands",
    properties: { id: { name: "Id", type: "number", isId: "increment" }, label: { name: "Label", type: "string" } }
};

/** field-access-read / field-access-driver-read: role rule, write-only rule, private with a column name. */
const staff: LegacyCollectionConfig = {
    name: "Staff", slug: "staff", table: "staff",
    properties: {
        id: { name: "Id", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        salary: { name: "Salary", type: "number", access: { read: ["hr"] } },
        rating: { name: "Rating", type: "number", access: { write: [] } },
        passwordHash: { name: "Password Hash", type: "string", columnName: "password_hash", excludeFromApi: true },
        // No `columnName`: its SQL name is derived, which the legacy path never knew.
        homeAddress: { name: "Home address", type: "string", access: { read: ["hr"] } }
    }
};

/** field-access-search: a role-restricted text column, a private one, a uuid key and an enum. */
const notes: LegacyCollectionConfig = {
    name: "Notes", slug: "notes", table: "notes",
    properties: {
        id: { name: "Id", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        secret: { name: "Secret", type: "string", access: { read: ["hr"] } },
        token: { name: "Token", type: "string", columnName: "api_token", excludeFromApi: true },
        status: { name: "Status", type: "string", enum: { open: "Open", closed: "Closed" } }
    }
};

/** field-access-read "a withheld to-one relation": the relation takes its foreign key. */
const people: LegacyCollectionConfig = {
    name: "People", slug: "people", table: "people",
    properties: {
        id: { name: "Id", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        band: {
            name: "Salary band", type: "relation", access: { read: ["hr"] },
            relation: { kind: "belongsTo", target: () => bands, localKey: "band_id" }
        },
        hiddenBand: {
            name: "Hidden band", type: "relation", excludeFromApi: true,
            relation: { kind: "belongsTo", target: () => bands, localKey: "hidden_band_id" }
        }
    }
};

/** field-access-read "`_count`": a to-many relation restricted by role. */
const teams: LegacyCollectionConfig = {
    name: "Teams", slug: "teams", table: "teams",
    properties: {
        id: { name: "Id", type: "number", isId: "increment" },
        members: { name: "Members", type: "relation", relation: { kind: "hasMany", target: () => people, foreignKeyOnTarget: "team_id" } },
        reviews: {
            name: "Reviews", type: "relation", access: { read: ["hr"] },
            relation: { kind: "hasMany", target: () => people, foreignKeyOnTarget: "review_team_id" }
        }
    }
};

const corpus: LegacyCollectionConfig[] = [staff, notes, people, teams, defaultUsersCollection];

const registry = new FixtureTableRegistry();
registry.registerMultiple([bands, ...corpus]);
const described = (collection: LegacyCollectionConfig): TableDescriptor => registry.requireTable(collection.slug).descriptor;

const VIEWERS: { label: string; viewer: FieldViewer | undefined }[] = [
    { label: "the trusted server plane", viewer: undefined },
    { label: "a caller with no roles", viewer: { roles: [] } },
    { label: "staff", viewer: { roles: ["staff"] } },
    { label: "hr", viewer: { roles: ["hr"] } },
    { label: "admin", viewer: { roles: ["admin"] } }
];
const CALLERS = VIEWERS.filter(({ viewer }) => viewer !== undefined);

/** Every name a caller could write for a field of this table, in either model's spelling. */
function everyName(collection: LegacyCollectionConfig, table: TableDescriptor): string[] {
    const names = new Set<string>();
    for (const [key, property] of Object.entries(collection.properties ?? {})) {
        names.add(key);
        if ((property as LegacyProperty).columnName) names.add(String((property as LegacyProperty).columnName));
    }
    for (const column of table.columns) {
        names.add(column.key);
        names.add(column.column);
    }
    for (const relation of table.relations) names.add(relation.name);
    return [...names].sort();
}

const refuses = (read: () => void): boolean => {
    try {
        read();
        return false;
    } catch {
        return true;
    }
};

/** What the new path withholds beyond the old, per table: expected and pinned. */
const stricter: string[] = [];

describe.each(corpus.map(collection => [collection.slug, collection] as const))("%s", (_slug, collection) => {
    const table = described(collection);
    const names = everyName(collection, table);

    describe.each(VIEWERS.map(v => [v.label, v.viewer] as const))("read, for %s", (_label, viewer) => {
        it("withholds every name the legacy strip withheld", () => {
            const legacy = restrictedFieldNames(collection, viewer, "read").refused;
            const row = Object.fromEntries(names.map(name => [name, 1]));
            const served = withFieldViewer(viewer, () => stripUnreadable({ ...row }, table));
            const withheld = names.filter(name => !(name in served));
            for (const name of legacy) if (names.includes(name)) expect(withheld).toContain(name);
            for (const name of withheld) if (!legacy.has(name)) stricter.push(`${collection.slug}.${name} (read)`);
        });
    });

    describe.each(CALLERS.map(v => [v.label, v.viewer] as const))("filter and sort, for %s", (_label, viewer) => {
        it("refuses every name the legacy path withheld", () => {
            const legacy = new Set([...restrictedFieldNames(collection, viewer, "read").refused, ...apiHiddenFieldNames(collection)]);
            const caller = viewer ?? {};
            for (const name of legacy) {
                expect(refuses(() => assertReadRequestReadable({ filter: { [name]: ["==", 1] } }, { slug: collection.slug }, caller, registry))).toBe(true);
                expect(refuses(() => assertReadRequestReadable({ orderBy: name }, { slug: collection.slug }, caller, registry))).toBe(true);
            }
        });
    });

    describe.each(VIEWERS.map(v => [v.label, v.viewer] as const))("search, for %s", (_label, viewer) => {
        it("searches no column the legacy search skipped", () => {
            const properties = (collection.properties ?? {}) as Record<string, LegacyProperty>;
            const legacySearched = new Set(Object.entries(properties)
                .filter(([, p]) => p.type === "string" && !p.enum && p.isId !== "uuid" && canReadField(p, viewer))
                // By SQL name: the column the legacy property read.
                .map(([key, p]) => p.columnName ?? table.columns.find(column => column.key === key)?.column ?? key));
            // A catalogue table with a text column under every key, so only the
            // descriptor decides what is searched.
            const pg = pgTable(table.table, Object.fromEntries(table.columns.map(column => [column.key, text(column.column)])));
            const conditions = withFieldViewer(viewer, () => DrizzleConditionBuilder.buildSearchConditions("x", pg, table));
            const sql = conditions.length > 0 ? new PgDialect().sqlToQuery(conditions[0]).sql : "";
            const searched = [...sql.matchAll(/"([^"]+)" ilike/g)].map(match => match[1]);
            for (const column of searched) expect(legacySearched).toContain(column);
            for (const column of legacySearched) if (!searched.includes(column)) stricter.push(`${collection.slug}.${column} (search)`);
        });
    });

    it("names in an unknown-field answer no name the legacy answer left out", () => {
        const pg = pgTable(table.table, Object.fromEntries(table.columns.map(column => [column.key, text(column.column)])));
        const listed = listedColumnKeys(pg, table);
        const legacyListed = new Set(queryableFieldNames(collection));
        for (const name of apiHiddenFieldNames(collection)) expect(listed).not.toContain(name);
        for (const name of listed) if (!legacyListed.has(name)) expect(table.columns.some(column => column.key === name)).toBe(true);
    });
});

describe("where the descriptor path is stricter", () => {
    it("withholds the derived SQL name of a restricted column, which the legacy path did not know", () => {
        const column = described(staff).columns.find(candidate => candidate.key === "homeAddress")?.column;
        const extra = [...new Set(stricter)].sort();
        if (column === "homeAddress") {
            // Derived names equal to the key: nothing extra to withhold.
            expect(extra).toEqual([]);
        } else {
            expect(extra).toEqual([`staff.${column} (read)`]);
        }
    });
});
