import { describe, expect, it } from "@jest/globals";
import { col, defineTable, json } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import {
    anonymousWriteRefusedBy,
    applyCreateDefaults,
    applyStamps,
    stampModifier
} from "../src/table/write-values";

/**
 * What the server writes into a row on its own, read off the descriptor:
 * create defaults (column literals, `.dbDefault()`, nested JSON defaults),
 * time and user stamps (columns and nested JSON fields), and the anonymous
 * refusal of a `.notNull()` user stamp.
 */

const accounts = defineTable("accounts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        active: col.boolean().default(true),
        currency: col.text().default("EUR"),
        region: col.text().dbDefault(),
        slugged: col.text().defaultSql("lower('X')"),
        note: col.text(),
        prefs: col.jsonb(json.object({
            notify: json.boolean().default(true),
            theme: json.string().default("dark"),
            nickname: json.string(),
            tags: json.array(json.string()),
            muted: json.boolean(),
            nested: json.object({ level: json.number().default(1), label: json.string() })
        })),
        plain: col.jsonb(json.object({ a: json.string(), b: json.number() })),
        createdAt: col.timestamptz().onCreateNow(),
        updatedAt: col.timestamptz().onUpdateNow(),
        createdBy: col.text().onCreateUser(),
        updatedBy: col.text().onUpdateUser(),
        audit: col.jsonb(json.object({
            firstAt: json.date().onCreateNow(),
            lastAt: json.date().onUpdateNow(),
            by: json.string().onCreateUser(),
            editedBy: json.string().onUpdateUser(),
            comment: json.string(),
            history: json.array(json.object({ at: json.date().onUpdateNow(), what: json.string() })),
            blocks: json.array(json.oneOf({
                stamped: json.object({ when: json.date().onCreateNow(), who: json.string().onUpdateUser() }),
                text: json.string()
            }))
        }))
    },
    rls: "admin-only"
});

const required = defineTable("required_authors", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        createdBy: col.text().notNull().onCreateUser(),
        note: col.text()
    },
    rls: "admin-only"
});

const requiredEditor = defineTable("required_editors", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        updatedBy: col.uuid().notNull().onUpdateUser()
    },
    rls: "admin-only"
});

const [table, requiredTable, requiredEditorTable] = compileTables([accounts, required, requiredEditor]);
const now = new Date("2026-11-12T10:00:00.000Z");

describe("applyCreateDefaults", () => {
    it("fills a literal default the caller did not send, and keeps what they sent (null included)", () => {
        expect(applyCreateDefaults(table, {})).toMatchObject({ active: true, currency: "EUR" });
        const sent = applyCreateDefaults(table, { active: false, currency: null });
        expect(sent.active).toBe(false);
        expect(sent.currency).toBeNull();
    });

    it("drops a null sent for a .dbDefault() column, keeps an absent one absent, and leaves SQL defaults to the database", () => {
        const out = applyCreateDefaults(table, { region: null });
        expect("region" in out).toBe(false);
        expect("slugged" in out).toBe(false);
        expect("note" in out).toBe(false);
        expect(applyCreateDefaults(table, { region: "eu" }).region).toBe("eu");
        // Only `.dbDefault()` drops a null: a SQL default column keeps the caller's null.
        expect(applyCreateDefaults(table, { slugged: null }).slugged).toBeNull();
    });

    it("builds an absent document from its fields' defaults, with each kind's empty value beside them", () => {
        expect(applyCreateDefaults(table, {}).prefs).toEqual({
            notify: true,
            theme: "dark",
            nickname: null,
            tags: [],
            muted: false,
            nested: { level: 1, label: null }
        });
    });

    it("merges the default document under a sent one, one level deep", () => {
        expect(applyCreateDefaults(table, { prefs: { notify: false, nested: { label: "x" } } }).prefs).toEqual({
            notify: false,
            theme: "dark",
            nickname: null,
            tags: [],
            muted: false,
            nested: { label: "x" }
        });
    });

    it("leaves a document whose fields declare no default alone", () => {
        expect("plain" in applyCreateDefaults(table, {})).toBe(false);
        expect(applyCreateDefaults(table, { plain: { a: "x" } }).plain).toEqual({ a: "x" });
    });

    it("hands each write its own copy of a default document", () => {
        const first = applyCreateDefaults(table, {}).prefs as Record<string, unknown>;
        first.theme = "light";
        expect((applyCreateDefaults(table, {}).prefs as Record<string, unknown>).theme).toBe("dark");
    });

    it("does not change the values it was given", () => {
        const values = { region: null };
        applyCreateDefaults(table, values);
        expect(values).toEqual({ region: null });
    });
});

describe("applyStamps — columns", () => {
    it("stamps every column on a create, replacing what was sent", () => {
        const out = applyStamps(table, { createdBy: "someone-else", createdAt: "1999-01-01" }, { creating: true, now, uid: "u1" });
        expect(out).toMatchObject({ createdAt: now, updatedAt: now, createdBy: "u1", updatedBy: "u1" });
    });

    it("stamps only the update columns on an update, and leaves the create ones as sent", () => {
        const out = applyStamps(table, { note: "x" }, { creating: false, now, uid: "u1" });
        expect(out).toEqual({ note: "x", updatedAt: now, updatedBy: "u1" });
    });

    it("writes an explicit null for a user stamp when nobody is acting", () => {
        const out = applyStamps(table, {}, { creating: false, now, uid: undefined });
        expect("updatedBy" in out).toBe(true);
        expect(out.updatedBy).toBeNull();
    });
});

describe("applyStamps — inside JSON documents", () => {
    it("creates an absent document on a create, with every stamp it declares", () => {
        const out = applyStamps(table, {}, { creating: true, now, uid: "u1" });
        expect(out.audit).toEqual({ firstAt: now, lastAt: now, by: "u1", editedBy: "u1" });
    });

    it("leaves a document an update does not send alone", () => {
        const out = applyStamps(table, { note: "x" }, { creating: false, now, uid: "u1" });
        expect("audit" in out).toBe(false);
    });

    it("stamps the update fields of a document an update sends, and keeps the rest of it", () => {
        const out = applyStamps(table, {
            audit: { firstAt: "2020-01-01", by: "creator", comment: "hi" }
        }, { creating: false, now, uid: "u2" });
        expect(out.audit).toEqual({ firstAt: "2020-01-01", by: "creator", comment: "hi", lastAt: now, editedBy: "u2" });
    });

    it("stamps each array item and each oneOf item's value by its variant", () => {
        const out = applyStamps(table, {
            audit: {
                history: [{ what: "a" }, null, { what: "b", at: "old" }],
                blocks: [
                    { type: "stamped", value: { who: "x" } },
                    { type: "text", value: "plain" },
                    { type: "unknown-variant", value: {} },
                    { type: "stamped" }
                ]
            }
        }, { creating: true, now, uid: "u3" });
        const audit = out.audit as Record<string, unknown>;
        expect(audit.history).toEqual([{ what: "a", at: now }, null, { what: "b", at: now }]);
        expect(audit.blocks).toEqual([
            { type: "stamped", value: { who: "u3", when: now } },
            { type: "text", value: "plain" },
            { type: "unknown-variant", value: {} },
            { type: "stamped", value: { when: now, who: "u3" } }
        ]);
    });

    it("on an update, stamps only update stamps in items too", () => {
        const out = applyStamps(table, {
            audit: { blocks: [{ type: "stamped", value: { when: "kept" } }] }
        }, { creating: false, now, uid: undefined });
        const audit = out.audit as Record<string, unknown>;
        expect(audit.blocks).toEqual([{ type: "stamped", value: { when: "kept", who: null } }]);
        expect(audit.editedBy).toBeNull();
        expect("by" in audit).toBe(false);
    });

    it("leaves a null document as the caller's null", () => {
        expect(applyStamps(table, { audit: null }, { creating: true, now, uid: "u1" }).audit).toBeNull();
    });
});

describe("anonymousWriteRefusedBy", () => {
    it("names a .notNull() user-stamped column a create would leave empty", () => {
        expect(anonymousWriteRefusedBy(requiredTable, true)).toBe("createdBy");
    });

    it("lets an update through when only the create stamp is .notNull()", () => {
        expect(anonymousWriteRefusedBy(requiredTable, false)).toBeUndefined();
        expect(anonymousWriteRefusedBy(requiredEditorTable, false)).toBe("updatedBy");
    });

    it("refuses nothing for nullable user stamps", () => {
        expect(anonymousWriteRefusedBy(table, true)).toBeUndefined();
    });
});

describe("stampModifier", () => {
    it("names the modifier that declares each stamp", () => {
        expect(stampModifier({ on: "create", value: "now" })).toBe(".onCreateNow()");
        expect(stampModifier({ on: "update", value: "now" })).toBe(".onUpdateNow()");
        expect(stampModifier({ on: "create", value: "user" })).toBe(".onCreateUser()");
        expect(stampModifier({ on: "update", value: "user" })).toBe(".onUpdateUser()");
    });
});
