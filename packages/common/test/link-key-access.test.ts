import { describe, expect, it } from "@jest/globals";
import { col, defineTable, rel } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import {
    apiHiddenKeys,
    boundKeyColumn,
    canReadRelation,
    canWriteRelation,
    hasJoinAccessRules,
    isPrivateRelation,
    relationJoinColumns,
    restrictedKeys
} from "../src/table/access";

/**
 * A `belongsTo` and the key column it is bound to are one fact under two names
 * (SEC-FIX-3 D-1 / D-2): `{ reviewer: 7 }` sets `reviewerId`, and
 * `?include=handler` reads the value `handlerId` holds. So a restriction on
 * either is a restriction on both, in every list every door reads.
 *
 * Before: a restricted relation took its key with it, but a restricted key
 * column left its link open — `PATCH { reviewer: v }` wrote a `.readOnly()`
 * column, `?include=handler` served an `access.read`-closed key.
 */

const people = defineTable("people", {
    columns: { id: col.text().primaryKey(), name: col.text() },
    rls: "admin-only"
});

const docs = defineTable("docs", {
    columns: {
        id: col.serial().primaryKey(),
        title: col.text(),
        createdBy: col.text().onCreateUser(),
        reviewerId: col.text().readOnly(),
        approverId: col.text().access({ read: ["admin"], write: ["admin"] }),
        handlerId: col.text().access({ read: ["hr"] }),
        informantId: col.text().private(),
        ownerId: col.text()
    },
    relations: {
        creator: rel.belongsTo(() => people, { localKey: "created_by" }),
        reviewer: rel.belongsTo(() => people, { localKey: "reviewer_id" }),
        approver: rel.belongsTo(() => people, { localKey: "approver_id" }),
        handler: rel.belongsTo(() => people, { localKey: "handler_id" }),
        informant: rel.belongsTo(() => people, { localKey: "informant_id" }),
        owner: rel.belongsTo(() => people, { localKey: "owner_id", private: true })
    },
    rls: "admin-only"
});

const [, docsT] = compileTables([people, docs]);
const relation = (name: string) => {
    const found = docsT.relations.find(candidate => candidate.name === name);
    if (!found) throw new Error(`no relation ${name}`);
    return found;
};
const editor = { roles: ["editor"] };

describe("a link follows its key column", () => {
    it("finds the column a belongsTo is bound to, and none for another kind", () => {
        expect(boundKeyColumn(docsT, relation("reviewer"))?.key).toBe("reviewerId");
        expect(boundKeyColumn(docsT, relation("creator"))?.key).toBe("createdBy");
    });

    it("is unwritable with a `.readOnly()`, `.private()` or role-closed key — for every caller, or for the caller outside the list", () => {
        expect(canWriteRelation(docsT, relation("reviewer"), editor)).toBe(false);
        expect(canWriteRelation(docsT, relation("reviewer"), { roles: ["admin"] })).toBe(false);
        expect(canWriteRelation(docsT, relation("informant"), { roles: ["admin"] })).toBe(false);
        expect(canWriteRelation(docsT, relation("approver"), editor)).toBe(false);
        expect(canWriteRelation(docsT, relation("approver"), { roles: ["admin"] })).toBe(true);
        expect(canWriteRelation(docsT, relation("handler"), editor)).toBe(true);
    });

    it("is unreadable with a role-closed or private key", () => {
        expect(canReadRelation(docsT, relation("handler"), editor)).toBe(false);
        expect(canReadRelation(docsT, relation("handler"), { roles: ["hr"] })).toBe(true);
        expect(canReadRelation(docsT, relation("informant"), { roles: ["admin"] })).toBe(false);
        expect(canReadRelation(docsT, relation("reviewer"), editor)).toBe(true);
    });

    it("is private with a private key, and a private link hides its key", () => {
        expect(isPrivateRelation(docsT, relation("informant"))).toBe(true);
        expect(isPrivateRelation(docsT, relation("handler"))).toBe(false);
        const hidden = apiHiddenKeys(docsT);
        for (const name of ["informant", "informantId", "informant_id", "owner", "ownerId", "owner_id"]) expect(hidden.has(name)).toBe(true);
        expect(hidden.has("handler")).toBe(false);
    });

    it("puts the link in the write list beside its closed key, by every spelling", () => {
        const { refused, declared } = restrictedKeys(docsT, editor, "write");
        for (const name of ["reviewer", "reviewerId", "reviewer_id", "approver", "approverId", "informant", "informantId"]) {
            expect(refused.has(name)).toBe(true);
        }
        expect(declared).toEqual(expect.arrayContaining(["reviewer", "approver", "informant"]));
        // A stamp is the driver's to apply, not a closed column: neither spelling is listed.
        expect(refused.has("creator")).toBe(false);
        expect(refused.has("createdBy")).toBe(false);
        expect(refused.has("handler")).toBe(false);
    });

    it("puts the link in the read list beside its closed key", () => {
        const { refused } = restrictedKeys(docsT, editor, "read");
        for (const name of ["handler", "handlerId", "handler_id", "approver", "informant"]) expect(refused.has(name)).toBe(true);
        expect(refused.has("reviewer")).toBe(false);
        expect(restrictedKeys(docsT, { roles: ["hr"] }, "read").refused.has("handler")).toBe(false);
    });
});

/**
 * SEC-FIX-4 R-1: one step further — a relation reads every column its join
 * condition reads, on every table it passes through, so a hidden key is hidden
 * from the `hasMany` / `hasOne` that point back through it and from a `via`
 * joined on it too.
 */
describe("a relation follows every column its join reads", () => {
    const staffT = defineTable("staff", {
        columns: { id: col.integer().primaryKey(), name: col.text() },
        relations: {
            handledCases: rel.hasMany(() => casesT, { foreignKey: "handler_id" }),
            informedCases: rel.hasMany(() => casesT, { foreignKey: "informant_id" }),
            notes: rel.hasMany(() => casesT, { foreignKey: "author_id" })
        },
        rls: "admin-only"
    });
    const casesT = defineTable("cases", {
        columns: {
            id: col.integer().primaryKey(),
            handlerId: col.integer().access({ read: ["hr"] }),
            informantId: col.integer().private(),
            authorId: col.integer()
        },
        relations: {
            handlerVia: rel.via(() => staffT, { cardinality: "one", steps: [{ table: "staff", on: { from: "handler_id", to: "id" } }] })
        },
        rls: "admin-only"
    });
    const [staffD, casesD] = compileTables([staffT, casesT]);
    const related = (name: string) => [staffD, casesD].find(table => table.slug === name || table.table === name);
    const relationOn = (table: typeof staffD, name: string) => {
        const found = table.relations.find(candidate => candidate.name === name);
        if (!found) throw new Error(name);
        return found;
    };

    it("names the join's columns on both sides, and on each via step", () => {
        expect(relationJoinColumns(staffD, relationOn(staffD, "handledCases"), related).map(c => `${c.column}`)).toEqual(["id", "handler_id"]);
        expect(relationJoinColumns(casesD, relationOn(casesD, "handlerVia"), related).map(c => c.column)).toEqual(["handler_id", "id"]);
        // Without the other tables, only this table's side is known.
        expect(relationJoinColumns(staffD, relationOn(staffD, "handledCases")).map(c => c.column)).toEqual(["id"]);
    });

    it("withholds the inverse and the via of a hidden key, and leaves an open join alone", () => {
        expect(canReadRelation(staffD, relationOn(staffD, "handledCases"), editor, related)).toBe(false);
        expect(canReadRelation(staffD, relationOn(staffD, "handledCases"), { roles: ["hr"] }, related)).toBe(true);
        expect(canReadRelation(staffD, relationOn(staffD, "notes"), editor, related)).toBe(true);
        expect(canReadRelation(casesD, relationOn(casesD, "handlerVia"), editor, related)).toBe(false);
        expect(restrictedKeys(staffD, editor, "read", related).refused.has("handledCases")).toBe(true);
        expect(restrictedKeys(staffD, editor, "read", related).refused.has("notes")).toBe(false);
        // A write sets no column through the inverse here: it is not closed by the read rule.
        expect(restrictedKeys(staffD, editor, "write", related).refused.has("handledCases")).toBe(false);
    });

    it("treats one joined on a private column as absent", () => {
        expect(isPrivateRelation(staffD, relationOn(staffD, "informedCases"), related)).toBe(true);
        expect(apiHiddenKeys(staffD, related).has("informedCases")).toBe(true);
        expect(apiHiddenKeys(staffD, related).has("handledCases")).toBe(false);
        expect(hasJoinAccessRules(staffD, related)).toBe(true);
    });
});
