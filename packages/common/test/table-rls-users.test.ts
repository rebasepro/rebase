import { describe, expect, it } from "@jest/globals";
import { col, defineTable, defineView, json, policy } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import { checkTableOperation, type CheckTableOperationOptions } from "../src/table/rls";
import { referencesUsers, userReferencePositions } from "../src/table/users";
import { formatJsonPath } from "../src/table/json-shape";

/**
 * A table's row-level security decided ahead of a row, and where it holds a
 * user's id — what the server's user picker and RLS simulator read.
 */

const id = () => col.uuid().primaryKey().defaultRandom();

const tasks = defineTable("tasks", {
    columns: {
        id: id(),
        assignee: col.uuid().userId(),
        watchers: col.text().userId().array(),
        meta: col.jsonb(json.object({ reviewer: json.string().userId(), note: json.string() })),
        title: col.text()
    },
    rls: [
        { operation: "select", access: "authenticated" },
        { operations: ["insert", "update"], roles: ["editor"] },
        { operation: "update", ownerField: "assignee" }
    ]
});
const secrets = defineTable("secrets", { columns: { id: id(), value: col.text() }, rls: "admin-only" });
const plain = defineTable("plain", { columns: { id: id(), name: col.text() }, rls: [{ operation: "all", access: "public" }] });
const guarded = defineTable("guarded", {
    columns: { id: id() },
    rls: [
        { operation: "insert", access: "authenticated" },
        { operation: "insert", mode: "restrictive", condition: policy.raw("current_setting('app.open') = 'yes'") }
    ]
});
const report = defineView("report", {
    query: "select 1 as id",
    materialized: true,
    roles: ["analyst"],
    columns: { id: col.integer().primaryKey() }
});

const [tasksT, secretsT, plainT, guardedT, reportT] = compileTables([tasks, secrets, plain, guarded, report]);
const editor = { uid: "u1", roles: ["editor"] };
const viewer = { uid: "u2", roles: ["viewer"] };
const admin = { uid: "a", roles: ["admin"] };

describe("userReferencePositions", () => {
    it("finds .userId() columns, array items and json fields", () => {
        expect(userReferencePositions(tasksT).map(p => [p.column.key, formatJsonPath(p.path)])).toEqual([
            ["assignee", ""],
            ["watchers", "[]"],
            ["meta", "reviewer"]
        ]);
        expect(referencesUsers(tasksT)).toBe(true);
        expect(referencesUsers(plainT)).toBe(false);
    });
});

describe("checkTableOperation", () => {
    it("evaluates the rules for the operation", () => {
        expect(checkTableOperation(tasksT, editor, "insert")).toBe(true);
        expect(checkTableOperation(tasksT, viewer, "insert")).toBe(false);
        expect(checkTableOperation(tasksT, viewer, "select")).toBe(true);
    });

    it("counts a row-dependent rule as allowing by default, and refusing when asked to fail closed", () => {
        // `ownerField` depends on the row: the viewer may update the rows assigned to them.
        expect(checkTableOperation(tasksT, viewer, "update")).toBe(true);
        expect(checkTableOperation(tasksT, viewer, "update", { onUnknown: "deny" })).toBe(false);
    });

    it("admits administrators alone on an admin-only table, and through the baseline elsewhere", () => {
        expect(checkTableOperation(secretsT, editor, "select")).toBe(false);
        expect(checkTableOperation(secretsT, admin, "delete")).toBe(true);
        expect(checkTableOperation(tasksT, admin, "delete")).toBe(true);
        expect(checkTableOperation(tasksT, editor, "delete")).toBe(false);
    });

    it("lets a restrictive rule veto, and a rule be rewritten before it is judged", () => {
        expect(checkTableOperation(guardedT, viewer, "insert")).toBe(true);
        // The restrictive rule is a bare `condition`, so swapping it for `false` keeps it a valid rule.
        const rawAsFalse: CheckTableOperationOptions = {
            mapRule: rule => rule.mode === "restrictive" && rule.condition !== undefined
                ? { operation: rule.operation, mode: "restrictive", condition: policy.false() }
                : rule
        };
        expect(checkTableOperation(guardedT, viewer, "insert", rawAsFalse)).toBe(false);
        expect(checkTableOperation(plainT, { roles: [] }, "delete")).toBe(true);
    });

    it("reads a view: select only, a materialized one by its roles", () => {
        expect(checkTableOperation(reportT, { roles: ["analyst"] }, "select")).toBe(true);
        expect(checkTableOperation(reportT, viewer, "select")).toBe(false);
        expect(checkTableOperation(reportT, { roles: ["analyst"] }, "insert")).toBe(false);
    });
});
