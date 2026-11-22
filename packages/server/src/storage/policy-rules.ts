/**
 * Storage access rules as data: `STORAGE_POLICIES`.
 *
 * `storagePolicies` is the declarative access model for storage, and it could
 * only be written in code — `allow` takes a predicate for anything past
 * "public" and "authenticated", and the managed runtime has no route for a
 * function. So a project that runs no code of its own (a Rebase Cloud project
 * on the stock backend) had two choices: every file public, or every signed-in
 * user allowed to touch every file. Neither is a storage model.
 *
 * Rules are the same deny-by-default list, with the two predicates nearly
 * every app writes named instead of coded: `"owner"` (the key's `:uid` segment
 * is the caller) and `{ roles }` (the caller holds one of these roles). They
 * compile to ordinary {@link StoragePolicy} entries, so matching, ordering and
 * the fallback to `storageAuthorize` are exactly the code form's.
 *
 * @module
 */
import type { StorageOperation, StorageRule } from "@rebasepro/types";
import { compileStoragePolicies, StoragePolicyError, type StoragePolicy } from "./policies";

const OPERATIONS: readonly StorageOperation[] = ["read", "write", "delete", "list"];
const RULE_KEYS = new Set(["path", "operations", "allow"]);

/** Whether a pattern captures a `:uid` segment, which `"owner"` compares. */
function capturesUid(path: string): boolean {
    return path.split("/").some(segment => segment === ":uid");
}

/**
 * Every problem with a rule list, one sentence each, naming the rule — empty
 * when it is usable. The control plane asks this before it saves a list, so a
 * mistake is refused in the console rather than at the next boot.
 */
export function storageRuleProblems(rules: unknown, label = "STORAGE_POLICIES"): string[] {
    if (!Array.isArray(rules)) return [`${label} must be a JSON array of rules.`];
    const problems: string[] = [];
    rules.forEach((rule: unknown, index) => {
        const at = `${label}[${index}]`;
        if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
            problems.push(`${at} must be an object with \`path\` and \`allow\`.`);
            return;
        }
        const record = rule as Record<string, unknown>;
        for (const key of Object.keys(record)) {
            if (!RULE_KEYS.has(key)) problems.push(`${at} has \`${key}\`, which a rule does not take (path, operations, allow).`);
        }
        if (typeof record.path !== "string" || record.path.trim() === "") {
            problems.push(`${at}: \`path\` must be a key pattern, such as "users/:uid/**".`);
        }
        if (record.operations !== undefined) {
            if (!Array.isArray(record.operations) || record.operations.length === 0) {
                problems.push(`${at}: \`operations\` is empty, so this rule grants nothing. Remove it to grant all.`);
            } else {
                for (const operation of record.operations) {
                    if (!OPERATIONS.includes(operation as StorageOperation)) {
                        problems.push(`${at}: \`operations\` names "${String(operation)}"; use ${OPERATIONS.map(o => `"${o}"`).join(", ")}.`);
                    }
                }
            }
        }
        const allow = record.allow;
        if (allow === "owner") {
            if (typeof record.path === "string" && !capturesUid(record.path)) {
                problems.push(`${at}: "owner" compares the key's \`:uid\` segment with the caller, and "${record.path}" has none — write it as "users/:uid/**".`);
            }
        } else if (typeof allow === "object" && allow !== null && !Array.isArray(allow)) {
            const roles = (allow as Record<string, unknown>).roles;
            const extra = Object.keys(allow).filter(key => key !== "roles");
            if (!Array.isArray(roles) || roles.length === 0 || roles.some(role => typeof role !== "string" || role.trim() === "")) {
                problems.push(`${at}: \`allow: { roles }\` must name at least one role.`);
            }
            if (extra.length > 0) problems.push(`${at}: \`allow\` takes only \`roles\`, not ${extra.map(k => `\`${k}\``).join(", ")}.`);
        } else if (allow !== "public" && allow !== "authenticated") {
            problems.push(`${at}: \`allow\` must be "public", "authenticated", "owner" or { "roles": [...] }.`);
        }
    });
    if (problems.length > 0) return problems;
    // The pattern language is the code form's: compile, so a pattern it would
    // refuse at boot is refused here, in its words.
    try {
        compileStoragePolicies(storagePoliciesFromRules(rules as StorageRule[]));
    } catch (err) {
        problems.push(err instanceof Error ? err.message.replace(/storagePolicies\[/g, `${label}[`) : String(err));
    }
    return problems;
}

/** The rules as the policies they mean. Assumes {@link storageRuleProblems} found none. */
export function storagePoliciesFromRules(rules: readonly StorageRule[]): StoragePolicy[] {
    return rules.map((rule): StoragePolicy => {
        const base = { path: rule.path, ...(rule.operations ? { operations: [...rule.operations] } : {}) };
        const allow = rule.allow;
        if (allow === "public" || allow === "authenticated") return { ...base, allow };
        if (allow === "owner") {
            return { ...base, allow: ({ params, user }) => Boolean(user?.uid) && params.uid === user?.uid };
        }
        const roles = new Set(allow.roles);
        return { ...base, allow: ({ user }) => Boolean(user?.uid) && (user?.roles ?? []).some(role => roles.has(role)) };
    });
}

/**
 * `STORAGE_POLICIES` read: unset or blank is no rules; anything else must be a
 * JSON array of valid rules, or the boot is refused naming every problem —
 * an access rule that was quietly dropped would fail open or shut without a word.
 */
export function storagePoliciesFromEnv(raw: string | undefined, variable = "STORAGE_POLICIES"): StoragePolicy[] | undefined {
    if (raw === undefined || raw.trim() === "") return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new StoragePolicyError(`${variable} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const problems = storageRuleProblems(parsed, variable);
    if (problems.length > 0) throw new StoragePolicyError(problems.join("\n"));
    return storagePoliciesFromRules(parsed as StorageRule[]);
}
