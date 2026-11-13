import { describe, expect, it } from "@jest/globals";
import { col, defineTable, rel } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import {
    apiHiddenKeys,
    boundKeyColumn,
    canReadRelation,
    canWriteRelation,
    isPrivateRelation,
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
