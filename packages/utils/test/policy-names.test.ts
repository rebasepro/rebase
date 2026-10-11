import type { SecurityRule } from "@rebasepro/types";
import { getPolicyNameHash, getPolicyNamesForRule, getPolicyNamesForRules, getPolicySupersededNames } from "../src/policy-names";

describe("getPolicyNamesForRule", () => {
    it("uses an explicit name as-is for a single-operation rule", () => {
        const rule: SecurityRule = { name: "owner_access", operation: "select" };
        expect(getPolicyNamesForRule(rule, "posts")).toEqual(["owner_access"]);
    });

    it("suffixes the operation onto an explicit name when a rule spans operations", () => {
        const rule: SecurityRule = { name: "owner_access", operations: ["select", "update"] };
        expect(getPolicyNamesForRule(rule, "posts")).toEqual(["owner_access_select", "owner_access_update"]);
    });

    it("derives <table>_<op>_<hash> when the rule has no name", () => {
        const rule: SecurityRule = { operation: "select", access: "public" };
        const [name] = getPolicyNamesForRule(rule, "posts");
        expect(name).toMatch(/^posts_select_[0-9a-f]{7}$/);
    });

    it("indexes the generated names of a multi-operation rule", () => {
        const rule: SecurityRule = { operations: ["insert", "update"], roles: ["admin"] };
        const names = getPolicyNamesForRule(rule, "posts");
        expect(names).toEqual([
            `posts_insert_${getPolicyNameHash(rule)}_0`,
            `posts_update_${getPolicyNameHash(rule)}_1`
        ]);
    });

    it("defaults to the 'all' operation when none is given", () => {
        const rule: SecurityRule = { roles: ["admin"] };
        expect(getPolicyNamesForRule(rule, "posts")[0]).toMatch(/^posts_all_[0-9a-f]{7}$/);
    });

    /**
     * These are the names `rebase db push` has already written into real
     * databases for the default rule set. They are pinned here because the
     * Studio matches live policies by name: if this derivation drifts, every
     * generated policy silently reappears as hand-written SQL that the UI
     * offers to "import" back into the codebase that created it.
     */
    it("reproduces the names present in a database built from the default rules", () => {
        const defaultSecurityRules: SecurityRule[] = [
            { operation: "select", access: "public" },
            { operations: ["insert", "update", "delete"], roles: ["admin"] }
        ];

        const names = defaultSecurityRules.flatMap(rule => getPolicyNamesForRule(rule, "products"));

        expect(names).toEqual([
            "products_select_841c287",
            "products_insert_3561e70_0",
            "products_update_3561e70_1",
            "products_delete_3561e70_2"
        ]);
    });

    it("ignores the ordering of roles and operations when hashing", () => {
        const a: SecurityRule = { operations: ["update", "insert"], roles: ["editor", "admin"] };
        const b: SecurityRule = { operations: ["insert", "update"], roles: ["admin", "editor"] };
        expect(getPolicyNameHash(a)).toBe(getPolicyNameHash(b));
    });

    it("gives rules with different meanings different hashes", () => {
        const read: SecurityRule = { operation: "select", access: "public" };
        const write: SecurityRule = { operation: "select", roles: ["admin"] };
        expect(getPolicyNameHash(read)).not.toBe(getPolicyNameHash(write));
    });
});

describe("getPolicyNamesForRules", () => {
    it("collects every generated name for membership checks", () => {
        const rules: SecurityRule[] = [
            { operation: "select", access: "public" },
            { operations: ["insert", "update", "delete"], roles: ["admin"] }
        ];

        const names = getPolicyNamesForRules(rules, "products");

        expect(names.has("products_select_841c287")).toBe(true);
        expect(names.has("products_delete_3561e70_2")).toBe(true);
        expect(names.size).toBe(4);
    });
});

/**
 * Postgres keeps the first 63 bytes of an identifier and drops the rest. A
 * rule spanning several operations whose names differ only past byte 63 — the
 * injected `<table>_default_admin_write_<op>` once the table is 42 bytes or
 * more — wrote three policies under one stored name, and each CREATE replaced
 * the last: only DELETE survived, so admin INSERT and UPDATE were RLS-denied.
 */
describe("getPolicyNamesForRule past Postgres's 63-byte identifier limit", () => {
    const adminWrite = (table: string): SecurityRule => ({
        name: `${table}_default_admin_write`,
        operations: ["insert", "update", "delete"],
        roles: ["admin"]
    });
    const bytes = (name: string) => new TextEncoder().encode(name).byteLength;

    it("gives a 50-byte table three names Postgres keeps apart", () => {
        const table = "t".repeat(50);
        const names = getPolicyNamesForRule(adminWrite(table), table);
        expect(names).toHaveLength(3);
        for (const name of names) expect(bytes(name)).toBeLessThanOrEqual(63);
        expect(new Set(names).size).toBe(3);
        expect(names.map(n => n.split("_").pop())).toEqual(["insert", "update", "delete"]);
        expect(names[0]).toMatch(/^t{47}_[0-9a-f]{8}_insert$/);
    });

    it("leaves a 10-byte table's names exactly as they were", () => {
        expect(getPolicyNamesForRule(adminWrite("short_tbl1"), "short_tbl1")).toEqual([
            "short_tbl1_default_admin_write_insert",
            "short_tbl1_default_admin_write_update",
            "short_tbl1_default_admin_write_delete"
        ]);
        expect(getPolicySupersededNames(adminWrite("short_tbl1"), "short_tbl1")).toEqual([]);
    });

    it("leaves a 41-byte table's names alone — the last length they still fit", () => {
        const table = "t".repeat(41);
        expect(getPolicyNamesForRule(adminWrite(table), table)[0]).toBe(`${table}_default_admin_write_insert`);
    });

    it("does not touch a single over-long name that is still unique", () => {
        const rule: SecurityRule = { name: `${"t".repeat(60)}_default_admin_read`, operation: "select" };
        expect(getPolicyNamesForRule(rule, "t".repeat(60))).toEqual([rule.name]);
        expect(getPolicySupersededNames(rule, "t".repeat(60))).toEqual([]);
    });

    it("renames an unnamed rule only when its operations collide too", () => {
        const rule: SecurityRule = { operations: ["insert", "update"], roles: ["admin"] };
        // 55 bytes: the names overrun 63, but the operation still tells them apart.
        const unique = getPolicyNamesForRule(rule, "t".repeat(55));
        expect(unique[0]).toBe(`${"t".repeat(55)}_insert_${getPolicyNameHash(rule)}_0`);
        // 62 bytes: the cut leaves nothing but the table, so they collide.
        const colliding = getPolicyNamesForRule(rule, "t".repeat(62));
        expect(new Set(colliding.map(n => n.slice(0, 63))).size).toBe(2);
        for (const name of colliding) expect(bytes(name)).toBeLessThanOrEqual(63);
    });

    it("names the one truncated policy the old naming left behind", () => {
        const table = "t".repeat(50);
        expect(getPolicySupersededNames(adminWrite(table), table)).toEqual([`${table}_default_admi`]);
    });

    it("counts bytes, not characters", () => {
        const table = "é".repeat(21); // 42 bytes
        const names = getPolicyNamesForRule(adminWrite(table), table);
        expect(new Set(names).size).toBe(3);
        for (const name of names) expect(bytes(name)).toBeLessThanOrEqual(63);
    });
});
