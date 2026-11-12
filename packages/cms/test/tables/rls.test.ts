/**
 * Client-side permission reflection (§6.1). The panel decides whether to show
 * Create, Edit and Delete with `checkOperation`, which reads a collection with
 * no `securityRules` as open to everyone. These tests ask `checkOperation`
 * itself — anonymous, a signed-in user, an editor, an admin — about projected
 * collections, so a projection that loses a rule shows up as a control offered
 * to someone the database refuses.
 */
import { describe, expect, it } from "@jest/globals";
import type { Entity, SecurityOperation, TableDescriptor, User } from "@rebasepro/types";
import { checkOperation, canReadCollection } from "@rebasepro/common";
import { collectionFromTable, REDACTED_SQL } from "../../src/tables";
import { anonymous, column, posts, rules, signedIn, table, tags, users, uuidId } from "./fixtures";

const OPERATIONS: SecurityOperation[] = ["select", "insert", "update", "delete"];

type Caller = { user: User | null };

const admin = signedIn(["admin"], "admin-1");
const editor = signedIn(["editor"], "editor-1");
const member = signedIn([], "member-1");

function can(t: TableDescriptor, caller: Caller, row: Record<string, unknown> | null = null): Record<SecurityOperation, boolean> {
    const collection = collectionFromTable(t, { tables: [t] });
    const entity: Entity | null = row ? { id: "1", path: t.slug, values: row } : null;
    const out = { select: false, insert: false, update: false, delete: false, all: false };
    for (const op of OPERATIONS) out[op] = checkOperation(collection, caller, entity, op);
    return out;
}

const none = { select: false, insert: false, update: false, delete: false, all: false };
const every = { select: true, insert: true, update: true, delete: true, all: false };

const notes = (rls: TableDescriptor["rls"], extra: Partial<TableDescriptor> = {}): TableDescriptor => table("notes", {
    columns: [uuidId(), column("ownerId", { kind: "uuid" }, { column: "owner_id" }), column("body", { kind: "text" })],
    rls,
    ...extra
});

describe("admin-only", () => {
    const t = notes({ posture: "admin-only", rules: [], defaultPolicies: true });

    it("projects to rules, never to an empty list", () => {
        const collection = collectionFromTable(t, { tables: [t] });
        expect(collection.securityRules?.length).toBeGreaterThan(0);
        expect(collection.securityRules?.map(r => r.name)).toEqual(["notes_default_admin_read", "notes_default_admin_write"]);
    });

    it("lets only the admin role act", () => {
        expect(can(t, admin)).toEqual(every);
        expect(can(t, editor)).toEqual(none);
        expect(can(t, member)).toEqual(none);
        expect(can(t, anonymous)).toEqual(none);
    });

    it("hides the collection from everyone else's navigation", () => {
        const collection = collectionFromTable(t, { tables: [t] });
        expect(canReadCollection(collection, admin)).toBe(true);
        expect(canReadCollection(collection, member)).toBe(false);
    });

    it("stays closed when the baseline is off — a posture the compiler refuses", () => {
        const closed = notes({ posture: "admin-only", rules: [], defaultPolicies: false });
        expect(collectionFromTable(closed, { tables: [closed] }).securityRules).toEqual([
            { name: "notes_closed", operations: ["all"], condition: { kind: "false" } }
        ]);
        expect(can(closed, admin)).toEqual(none);
        expect(can(closed, anonymous)).toEqual(none);
    });

    it("ignores rules that arrive beside it", () => {
        const odd = notes({ posture: "admin-only", rules: [{ operation: "all", access: "public" }], defaultPolicies: true });
        expect(can(odd, anonymous)).toEqual(none);
    });
});

describe("declared rules", () => {
    it("adds the admin baseline: admins can always act", () => {
        const t = notes(rules([{ operation: "select", access: "public" }]));
        expect(can(t, admin)).toEqual(every);
        expect(can(t, anonymous)).toEqual({ ...none, select: true });
        expect(can(t, editor)).toEqual({ ...none, select: true });
    });

    it("without the baseline, admins get only what the rules give them", () => {
        const t = notes(rules([{ operation: "select", access: "public" }], false));
        expect(can(t, admin)).toEqual({ ...none, select: true });
        expect(collectionFromTable(t, { tables: [t] }).securityRules?.map(r => r.name)).toEqual([undefined]);
    });

    it("role rules gate per operation", () => {
        const t = notes(rules([
            { operations: ["select", "insert", "update"], roles: ["editor"] },
            { operation: "delete", roles: ["admin"] }
        ], false));
        expect(can(t, editor)).toEqual({ select: true, insert: true, update: true, delete: false, all: false });
        expect(can(t, admin)).toEqual({ ...none, delete: true });
        expect(can(t, member)).toEqual(none);
    });

    it("owner rules decide per row, and stay shown when there is no row yet", () => {
        const t = notes(rules([{ operation: "all", ownerField: "owner_id" }], false));
        expect(can(t, member, { owner_id: "member-1" })).toEqual(every);
        expect(can(t, member, { owner_id: "someone-else" })).toEqual(none);
        // No row in hand: unknown, and the panel's gating is optimistic.
        expect(can(t, member).select).toBe(true);
    });

    it("a structured condition on the row is evaluated on the row", () => {
        const published = can(posts, anonymous, { status: "published", orgId: "o1" });
        const draft = can(posts, anonymous, { status: "draft", orgId: "o1" });
        // Tenancy compares a claim, which only Postgres can answer: unknown, so not hidden.
        expect(published.select).toBe(true);
        expect(draft.select).toBe(false);
        expect(draft.insert).toBe(false);
    });

    it("keeps the spec's posts permissions for anonymous, editor and admin", () => {
        expect(can(posts, editor)).toEqual({ select: true, insert: true, update: true, delete: false, all: false });
        expect(can(posts, admin)).toEqual(every);
        expect(can(posts, anonymous, { status: "published" })).toEqual({ ...none, select: true });
    });
});

describe("raw SQL", () => {
    it("a raw rule is unknown, so it hides nothing", () => {
        const t = notes(rules([{ operation: "update", using: "owner_id = rebase.uid() AND exists (select 1)" }], false));
        expect(can(t, member).update).toBe(true);
    });

    it("a clause the server withheld evaluates exactly as a raw clause does", () => {
        const withheld = (marker: unknown): TableDescriptor => {
            const rule = { operation: "update" as const, using: "x" };
            Reflect.set(rule, "using", marker);
            return notes(rules([rule], false));
        };
        for (const marker of [{ raw: true }, true, null, 0]) {
            const t = withheld(marker);
            const collection = collectionFromTable(t, { tables: [t] });
            expect(collection.securityRules).toEqual([{ operation: "update", using: REDACTED_SQL }]);
            expect(can(t, member).update).toBe(true);
            expect(can(t, anonymous).update).toBe(true);
            expect(can(t, member).delete).toBe(false);
        }
    });

    it("a withheld WITH CHECK keeps the rule's USING and its targeting", () => {
        const rule = { operation: "insert" as const, roles: ["editor"], withCheck: "x" };
        Reflect.set(rule, "withCheck", { raw: true });
        const t = notes(rules([rule], false));
        expect(collectionFromTable(t, { tables: [t] }).securityRules).toEqual([
            { operation: "insert", roles: ["editor"], withCheck: REDACTED_SQL }
        ]);
        expect(can(t, editor).insert).toBe(true);
        expect(can(t, member).insert).toBe(false);
    });

    it("a withheld clause never turns a restrictive rule into a grant", () => {
        const restrictive = { operation: "update" as const, mode: "restrictive" as const, using: "x" };
        Reflect.set(restrictive, "using", { raw: true });
        const t = notes(rules([restrictive], false));
        // Only a restrictive rule: nothing grants, so nothing is offered.
        expect(can(t, admin).update).toBe(false);
    });
});

describe("auth table", () => {
    it("lets a user read their own row and only admins write, as Postgres does", () => {
        const t = { ...users, rls: rules([{ operation: "update", ownerField: "id" }]) };
        expect(can(t, member, { id: "member-1" })).toEqual({ select: true, insert: false, update: false, delete: false, all: false });
        expect(can(t, member, { id: "other" }).select).toBe(false);
        expect(can(t, admin, { id: "other" })).toEqual(every);
    });

    it("an admin-only auth table is the admin's alone", () => {
        expect(can(users, admin)).toEqual(every);
        expect(can(users, editor, { id: "other" })).toEqual(none);
    });
});

describe("tenant", () => {
    it("adds the restrictive tenancy rule, which only the server can decide", () => {
        const collection = collectionFromTable(posts, { tables: [posts] });
        const tenancy = collection.securityRules?.find(r => r.name === "posts_tenant_scope");
        expect(tenancy).toMatchObject({ mode: "restrictive", operation: "all" });
        // A bypass role passes outright.
        expect(can(posts, admin, { status: "draft", orgId: "o1" }).update).toBe(true);
    });
});

describe("views", () => {
    const view = (materialized: boolean, roles?: string[]): TableDescriptor => table("post_stats", {
        kind: "view",
        columns: [column("postId", { kind: "uuid" }), column("views", { kind: "integer" })],
        primaryKey: ["postId"],
        view: { materialized, ...(roles ? { roles } : {}) },
        rls: { posture: "view", rules: [], defaultPolicies: false }
    });

    it("a plain view is read-only and listed: the tables it reads decide its rows", () => {
        const t = view(false);
        expect(can(t, member)).toEqual({ ...none, select: true });
        expect(can(t, anonymous)).toEqual({ ...none, select: true });
        expect(can(t, admin)).toEqual({ ...none, select: true });
        expect(collectionFromTable(t, { tables: [t] }).view).toEqual({ query: "", materialized: false });
    });

    it("a materialized view is read by the roles it names, and by admins when it names none", () => {
        expect(can(view(true), admin)).toEqual({ ...none, select: true });
        expect(can(view(true), member)).toEqual(none);
        expect(can(view(true, ["analyst"]), signedIn(["analyst"]))).toEqual({ ...none, select: true });
        expect(can(view(true, ["analyst"]), editor)).toEqual(none);
    });

    it("a table carrying the view posture, which the compiler never emits, grants nothing", () => {
        const odd = notes({ posture: "view", rules: [{ operation: "all", access: "public" }], defaultPolicies: true });
        expect(collectionFromTable(odd, { tables: [odd] }).securityRules).toEqual([
            { name: "notes_closed", operations: ["all"], condition: { kind: "false" } }
        ]);
        expect(can(odd, admin)).toEqual(none);
        expect(can(odd, anonymous)).toEqual(none);
    });

    it("never projects an empty rule list", () => {
        for (const t of [view(false), view(true)]) {
            expect(collectionFromTable(t, { tables: [t] }).securityRules?.length).toBeGreaterThan(0);
        }
    });
});

it("every projected table carries rules", () => {
    for (const t of [posts, users, tags]) {
        expect(collectionFromTable(t, { tables: [t] }).securityRules?.length).toBeGreaterThan(0);
    }
});
