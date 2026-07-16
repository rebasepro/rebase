import type { SecurityRule } from "@rebasepro/types";
import { getPolicyNameHash, getPolicyNamesForRule, getPolicyNamesForRules } from "../src/policy-names";

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
