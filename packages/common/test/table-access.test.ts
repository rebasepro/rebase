import { describe, expect, it } from "@jest/globals";
import { col, defineTable, rel } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { compileTables } from "../src/schema/compile-tables";
import { collectionsToTableDefs } from "../src/migrate";
import { apiHiddenFieldNames, restrictedFieldNames } from "../src/collections/field-access";
import {
    apiHiddenKeys,
    canReadColumn,
    canWriteColumn,
    columnAccess,
    hasColumnAccessRules,
    restrictedKeys
} from "../src/table/access";
import { ALL } from "./schema/fixtures/legacy-capabilities";

/**
 * Column access read from the descriptor: the same semantics as common's
 * `collections/field-access.ts` (`private` is `excludeFromApi`, an absent list
 * defers to the row's policies, an empty one closes the direction to
 * everyone, `admin` and the trusted plane pass a non-empty one). The agreement
 * block pins the two models to one answer on every lifted fixture.
 */

const bands = defineTable("bands", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text() },
    rls: "admin-only"
});

const members = defineTable("members", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text(),
        salary: col.integer().column("salary_cents").access({ read: ["hr"], write: ["hr"] }),
        passwordHash: col.text().private(),
        notes: col.text().access({ read: [] }),
        bandId: col.uuid()
    },
    relations: {
        band: rel.belongsTo(() => bands, { localKey: "band_id", access: { read: ["manager"] } })
    },
    rls: "admin-only"
});

const [, membersT] = compileTables([bands, members]);
const column = (key: string) => {
    const found = membersT.columns.find(c => c.key === key);
    if (!found) throw new Error(`no column ${key}`);
    return found;
};

describe("columnAccess", () => {
    it("expands private to the empty lists, and is undefined for an unrestricted column", () => {
        expect(columnAccess(column("passwordHash"))).toEqual({ read: [], write: [] });
        expect(columnAccess(column("name"))).toBeUndefined();
        expect(columnAccess(column("salary"))).toEqual({ read: ["hr"], write: ["hr"] });
    });
});

describe("canReadColumn / canWriteColumn", () => {
    it("admits the named roles and admin, and no viewer at all (the trusted plane)", () => {
        expect(canReadColumn(column("salary"), { roles: ["hr"] })).toBe(true);
        expect(canReadColumn(column("salary"), { roles: ["admin"] })).toBe(true);
        expect(canReadColumn(column("salary"), undefined)).toBe(true);
        expect(canReadColumn(column("salary"), { roles: ["user"] })).toBe(false);
        expect(canReadColumn(column("salary"), { roles: [] })).toBe(false);
        expect(canWriteColumn(column("salary"), { roles: ["hr"] })).toBe(true);
        expect(canWriteColumn(column("salary"), { roles: ["user"] })).toBe(false);
    });

    it("closes an empty list to everyone, the admin and the trusted plane included", () => {
        expect(canReadColumn(column("notes"), { roles: ["admin"] })).toBe(false);
        expect(canReadColumn(column("notes"), undefined)).toBe(false);
        // An absent write list defers to the row's policies.
        expect(canWriteColumn(column("notes"), { roles: ["user"] })).toBe(true);
        expect(canReadColumn(column("passwordHash"), undefined)).toBe(false);
        expect(canWriteColumn(column("passwordHash"), undefined)).toBe(false);
    });
});

describe("restrictedKeys / apiHiddenKeys", () => {
    it("names a restricted column by key and SQL name, and a restricted belongsTo with its foreign key", () => {
        const read = restrictedKeys(membersT, { roles: ["user"] }, "read");
        expect(read.declared.sort()).toEqual(["band", "bandId", "notes", "passwordHash", "salary"]);
        expect([...read.refused].sort()).toEqual(
            ["band", "bandId", "band_id", "notes", "passwordHash", "password_hash", "salary", "salary_cents"]
        );
        expect(restrictedKeys(membersT, { roles: ["admin"] }, "read").declared.sort()).toEqual(["notes", "passwordHash"]);
    });

    it("hides only what is private", () => {
        expect([...apiHiddenKeys(membersT)].sort()).toEqual(["passwordHash", "password_hash"]);
    });

    it("says whether anything is restricted at all", () => {
        expect(hasColumnAccessRules(membersT)).toBe(true);
        expect(hasColumnAccessRules(compileTables([bands])[0])).toBe(false);
    });
});

describe("access agrees with field-access on every lifted fixture", () => {
    const fixtures: LegacyCollectionConfig[] = ALL;
    const { tables, defaultRls } = collectionsToTableDefs(fixtures);
    const descriptors = compileTables(tables, defaultRls ? { defaultRls } : {});
    const viewers = [undefined, { roles: [] }, { roles: ["user"] }, { roles: ["editor"] }, { roles: ["admin"] }];

    it.each(fixtures.map((collection, index) => [collection.slug, collection, index] as const))(
        "%s",
        (_slug, collection, index) => {
            const descriptor = descriptors[index];
            expect([...apiHiddenKeys(descriptor)].sort()).toEqual([...apiHiddenFieldNames(collection)].sort());
            const sqlNames = new Set(descriptor.columns.map(c => c.column));
            for (const viewer of viewers) {
                for (const kind of ["read", "write"] as const) {
                    const fromDescriptor = restrictedKeys(descriptor, viewer, kind);
                    const legacy = restrictedFieldNames(collection, viewer, kind);
                    // Every key and relation name agrees.
                    expect(fromDescriptor.declared).toEqual(expect.arrayContaining(legacy.declared));
                    // The legacy set names a column's SQL name only when `columnName` was
                    // written; the descriptor always knows it. So: the legacy set is
                    // contained, and anything more is the SQL name of a refused column.
                    for (const name of legacy.refused) expect(fromDescriptor.refused.has(name)).toBe(true);
                    for (const name of fromDescriptor.refused) {
                        if (!legacy.refused.has(name)) expect(sqlNames.has(name)).toBe(true);
                    }
                }
            }
        }
    );
});
