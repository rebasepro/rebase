/**
 * "Every check reports a table only when one of those roles can reach it."
 *
 * The README and the docs promise that, and three paths did not keep it:
 *
 *   - `policy-always-true` (and the two tautology checks beside it) never
 *     looked at grants: `USING (true) TO anon` on a table anon holds nothing on
 *     was critical and certain while anon got "permission denied";
 *   - `junction-table-unprotected` had no exposure gate at all;
 *   - schema USAGE was ignored everywhere: a table in a schema anon cannot use
 *     was a critical `rls-disabled`, though anon cannot even name it.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_ROLES, foreignKey, grant, policy, role, snapshot, table } from "../../test/fixtures/snapshot";
import type { DbSnapshot, Finding } from "../types";
import { junctionTableUnprotected } from "./junction-table-unprotected";
import { policyAlwaysTrue } from "./policy-always-true";
import { policyAnonymousTautology } from "./policy-anonymous-tautology";
import { policyAuthenticatedTautology } from "./policy-authenticated-tautology";
import { rlsDisabled } from "./rls-disabled";

/** What a check calls an exposure: anything above the `info` a latent finding is. */
const exposures = (findings: Finding[]): Finding[] => findings.filter((f) => f.severity !== "info");

describe("a policy check reports only a table its roles can reach", () => {
    const withGrants = (grants: DbSnapshot["grants"], command: "SELECT" | "INSERT" | "ALL" = "SELECT") =>
        snapshot({
            relations: [table("public", "notes", { rlsEnabled: true })],
            policies: [
                policy("public", "notes", "open", {
                    command,
                    roles: ["anon"],
                    using: command === "INSERT" ? null : "true",
                    withCheck: command === "SELECT" ? null : "true"
                })
            ],
            grants
        });

    it("policy-always-true: not without a grant", () => {
        expect(exposures(policyAlwaysTrue.run(withGrants([])))).toEqual([]);
        expect(policyAlwaysTrue.run(withGrants([grant("public", "notes", "anon", ["SELECT"])]))).toHaveLength(1);
    });

    it("policy-always-true: not when the grant is for another command", () => {
        expect(
            exposures(policyAlwaysTrue.run(withGrants([grant("public", "notes", "anon", ["SELECT"])], "INSERT")))
        ).toEqual([]);
        expect(
            policyAlwaysTrue.run(withGrants([grant("public", "notes", "anon", ["INSERT"])], "INSERT"))
        ).toHaveLength(1);
    });

    it("policy-always-true: not when the grant goes to a role the policy does not apply to", () => {
        expect(
            exposures(policyAlwaysTrue.run(withGrants([grant("public", "notes", "authenticated", ["SELECT"])])))
        ).toEqual([]);
    });

    it("policy-always-true: a grant through membership or to PUBLIC reaches", () => {
        expect(policyAlwaysTrue.run(withGrants([grant("public", "notes", "PUBLIC", ["SELECT"])]))).toHaveLength(1);
        expect(
            policyAlwaysTrue.run({
                ...withGrants([grant("public", "notes", "app_reader", ["SELECT"])]),
                roles: [
                    ...DEFAULT_ROLES.filter((r) => r.name !== "anon"),
                    role("anon", { memberOf: ["app_reader"] }),
                    role("app_reader")
                ]
            })
        ).toHaveLength(1);
    });

    it("the tautology checks: not without a grant", () => {
        const tautology = (using: string, grants: DbSnapshot["grants"]) =>
            snapshot({
                platform: "rebase",
                relations: [table("public", "notes", { rlsEnabled: true })],
                policies: [policy("public", "notes", "p", { roles: ["public"], using })],
                grants
            });
        const anonymous = "(auth.uid() IS NOT NULL)";
        const authenticated = "((auth.uid() IS NOT NULL) AND (auth.uid() <> 'anonymous'::text))";
        const granted = [grant("public", "notes", "authenticated", ["SELECT"])];

        expect(policyAnonymousTautology.run(tautology(anonymous, []))).toEqual([]);
        expect(policyAnonymousTautology.run(tautology(anonymous, granted))).toHaveLength(1);
        expect(policyAuthenticatedTautology.run(tautology(authenticated, []))).toEqual([]);
        expect(policyAuthenticatedTautology.run(tautology(authenticated, granted))).toHaveLength(1);
    });
});

describe("junction-table-unprotected reports only a join table something untrusted can read", () => {
    const join = (grants: DbSnapshot["grants"]) =>
        snapshot({
            relations: [
                table("public", "posts", { rlsEnabled: true }),
                table("public", "tags", { rlsEnabled: true }),
                table("public", "posts_tags", { columns: ["post_id", "tag_id"] })
            ],
            foreignKeys: [
                foreignKey("public", "posts_tags", ["post_id"], "public", "posts"),
                foreignKey("public", "posts_tags", ["tag_id"], "public", "tags")
            ],
            grants
        });

    it("is silent on an ungranted join table", () => {
        expect(junctionTableUnprotected.run(join([]))).toEqual([]);
        expect(
            junctionTableUnprotected.run(join([grant("public", "posts_tags", "service_role", ["SELECT"])]))
        ).toEqual([]);
    });

    it("reports one an exposed role can read", () => {
        expect(
            junctionTableUnprotected.run(join([grant("public", "posts_tags", "anon", ["SELECT"])]))
        ).toHaveLength(1);
    });
});

describe("a role without USAGE on the schema reaches nothing in it", () => {
    const hidden = (schemaUsage: DbSnapshot["schemaUsage"]) =>
        snapshot({
            schemas: ["public", "internal"],
            relations: [table("internal", "secrets")],
            grants: [grant("internal", "secrets", "anon", ["SELECT"])],
            schemaUsage
        });

    it("does not report a table in a schema anon cannot use", () => {
        expect(rlsDisabled.run(hidden([{ schema: "internal", grantee: "postgres" }]))).toEqual([]);
    });

    it("reports it once anon can use the schema — directly, through PUBLIC or through membership", () => {
        expect(rlsDisabled.run(hidden([{ schema: "internal", grantee: "anon" }]))).toHaveLength(1);
        expect(rlsDisabled.run(hidden([{ schema: "internal", grantee: "PUBLIC" }]))).toHaveLength(1);
        expect(
            rlsDisabled.run({
                ...hidden([{ schema: "internal", grantee: "api_schema_users" }]),
                roles: [
                    ...DEFAULT_ROLES.filter((r) => r.name !== "anon"),
                    role("anon", { memberOf: ["api_schema_users"] }),
                    role("api_schema_users")
                ]
            })
        ).toHaveLength(1);
    });

    it("assumes USAGE when the scan could not read schema privileges", () => {
        // Unknown is not "no": a degraded read must widen the scan, not narrow it.
        expect(rlsDisabled.run(hidden(undefined))).toHaveLength(1);
    });

    it("assumes USAGE on a schema it has no record of", () => {
        expect(rlsDisabled.run(hidden([{ schema: "public", grantee: "PUBLIC" }]))).toHaveLength(1);
    });
});

/**
 * An unconditional policy no exposed role can reach the table through yet is
 * silent as an exposure, which is what the docs promise. It is still one
 * GRANT away from a critical one — a `GRANT SELECT … TO anon` in a later
 * migration makes it live with nothing else changed — so it is reported as
 * `info`, "latent", below every `--fail-on` but `info`.
 */
describe("policy-always-true reports an unconditional policy nobody can reach yet as latent info", () => {
    const open = (grants: DbSnapshot["grants"], extra: Partial<DbSnapshot> = {}, roles = ["anon"]) =>
        snapshot({
            relations: [table("public", "notes", { rlsEnabled: true })],
            policies: [policy("public", "notes", "open", { roles, using: "true" })],
            grants,
            ...extra
        });

    it("is info, not an exposure, when the role holds no privilege for the command", () => {
        const findings = policyAlwaysTrue.run(open([]));
        expect(findings).toHaveLength(1);
        const [f] = findings;
        expect(f.id).toBe("policy-always-true");
        expect(f.severity).toBe("info");
        expect(f.title).toContain("latent");
        expect(f.target.policy).toBe("open");
        expect(f.detail).toContain("SELECT");
        expect(f.impact).toContain("permission denied");
        expect(f.impact).toContain("GRANT");
        expect(f.fix).toContain('ALTER POLICY "open" ON "public"."notes"');
    });

    it("is info when the role holds the privilege but not USAGE on the schema", () => {
        const [f] = policyAlwaysTrue.run(open(
            [grant("public", "notes", "anon", ["SELECT"])],
            { schemaUsage: [{ schema: "public", grantee: "postgres" }] }
        ));
        expect(f.severity).toBe("info");
        expect(f.detail).toContain("USAGE");
    });

    it("becomes the critical exposure once the grant is there", () => {
        const [f] = policyAlwaysTrue.run(open([grant("public", "notes", "anon", ["SELECT"])]));
        expect(f.severity).toBe("critical");
        expect(f.title).not.toContain("latent");
    });

    it("says nothing for a policy that names no exposed role", () => {
        expect(policyAlwaysTrue.run(open([], {}, ["service_role"]))).toEqual([]);
    });

    it("says nothing for a policy that scopes its rows", () => {
        const scoped = open([]);
        scoped.policies[0].using = "(user_id = auth.uid())";
        expect(policyAlwaysTrue.run(scoped)).toEqual([]);
    });
});
