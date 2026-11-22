import type { StorageAuthorizeContext, StorageOperation, StorageRule } from "@rebasepro/types";
import { compileStoragePolicies } from "./policies";
import { storagePoliciesFromEnv, storagePoliciesFromRules, storageRuleProblems } from "./policy-rules";

const RULES: StorageRule[] = [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: "owner" },
    { path: "shared/**", operations: ["read", "list"], allow: "authenticated" },
    { path: "**", allow: { roles: ["admin"] } }
];

const authorize = compileStoragePolicies(storagePoliciesFromRules(RULES));

const ada = { uid: "ada", roles: ["editor"] };
const grace = { uid: "grace" };
const root = { uid: "root", roles: ["admin"] };

function may(user: StorageAuthorizeContext["user"], operation: StorageOperation, key: string) {
    return authorize({ key, operation, user, bucket: "b" });
}

describe("storage rules, as the authorize they compile to", () => {
    it("serves public/ to anyone, for reading only", async () => {
        expect(await may(null, "read", "public/logo.png")).toBe(true);
        expect(await may(null, "write", "public/logo.png")).toBe(false);
        expect(await may(ada, "write", "public/logo.png")).toBe(false);
    });

    it("gives each user their own folder and nobody else's", async () => {
        expect(await may(ada, "write", "users/ada/avatar.png")).toBe(true);
        expect(await may(ada, "list", "users/ada/")).toBe(true);
        expect(await may(ada, "read", "users/grace/avatar.png")).toBe(false);
        expect(await may(grace, "delete", "users/ada/avatar.png")).toBe(false);
        expect(await may(null, "read", "users/ada/avatar.png")).toBe(false);
    });

    it("lets any signed-in user read a shared folder but not write it", async () => {
        expect(await may(grace, "read", "shared/handbook.pdf")).toBe(true);
        expect(await may(grace, "write", "shared/handbook.pdf")).toBe(false);
        expect(await may(null, "read", "shared/handbook.pdf")).toBe(false);
    });

    it("lets a role reach everything its rule names", async () => {
        expect(await may(root, "delete", "users/ada/avatar.png")).toBe(true);
        expect(await may(root, "write", "anything/at/all")).toBe(true);
        expect(await may(ada, "write", "anything/at/all")).toBe(false);
    });

    it("refuses a key no rule covers", async () => {
        const narrow = compileStoragePolicies(storagePoliciesFromRules([{ path: "public/**", allow: "public" }]));
        expect(await narrow({ key: "private/x", operation: "read", user: ada, bucket: "b" })).toBe(false);
    });
});

describe("storageRuleProblems", () => {
    it("finds none in a usable list", () => {
        expect(storageRuleProblems(RULES)).toEqual([]);
    });

    it("refuses an owner rule whose path captures no uid, saying how to write it", () => {
        const problems = storageRuleProblems([{ path: "avatars/**", allow: "owner" }]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/:uid/);
        expect(problems[0]).toContain("STORAGE_POLICIES[0]");
    });

    it("names every problem, rule by rule", () => {
        const problems = storageRuleProblems([
            { path: "", allow: "public" },
            { path: "a/**", allow: "everyone" },
            { path: "b/**", allow: { roles: [] } },
            { path: "c/**", operations: ["upload"], allow: "public" },
            { path: "d/**", allow: "public", extra: true }
        ]);
        expect(problems.some(p => p.startsWith("STORAGE_POLICIES[0]"))).toBe(true);
        expect(problems.some(p => p.startsWith("STORAGE_POLICIES[1]"))).toBe(true);
        expect(problems.some(p => p.startsWith("STORAGE_POLICIES[2]"))).toBe(true);
        expect(problems.some(p => p.startsWith("STORAGE_POLICIES[3]") && p.includes("upload"))).toBe(true);
        expect(problems.some(p => p.startsWith("STORAGE_POLICIES[4]") && p.includes("extra"))).toBe(true);
    });

    it("refuses a pattern the matcher would refuse, in its words", () => {
        const problems = storageRuleProblems([{ path: "**/tail", allow: "public" }]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("STORAGE_POLICIES[0]");
    });

    it("refuses something that is not a list", () => {
        expect(storageRuleProblems({ path: "x" })).toEqual(["STORAGE_POLICIES must be a JSON array of rules."]);
    });
});

describe("STORAGE_POLICIES", () => {
    it("is no rules when unset or blank", () => {
        expect(storagePoliciesFromEnv(undefined)).toBeUndefined();
        expect(storagePoliciesFromEnv("  ")).toBeUndefined();
    });

    it("reads a JSON list into policies", () => {
        expect(storagePoliciesFromEnv(JSON.stringify(RULES))).toHaveLength(4);
    });

    it("refuses the boot on bad JSON or a bad rule, naming the variable", () => {
        expect(() => storagePoliciesFromEnv("[{")).toThrow(/STORAGE_POLICIES is not valid JSON/);
        expect(() => storagePoliciesFromEnv(JSON.stringify([{ path: "x/**", allow: "owner" }]))).toThrow(/:uid/);
    });
});
