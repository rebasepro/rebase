import { describe, expect, it } from "vitest";

import { grant, policy, snapshot, table } from "../../test/fixtures/snapshot";
import { anonymousWriteAllowed } from "./anonymous-write-allowed";

const scenario = (
    policies: ReturnType<typeof policy>[],
    grants = [grant("public", "comments", "anon", ["SELECT", "INSERT", "UPDATE", "DELETE"])]
) =>
    snapshot({
        relations: [table("public", "comments", { rlsEnabled: true, columns: ["id", "user_id"] })],
        policies,
        grants
    });

describe("anonymous-write-allowed", () => {
    it("flags an INSERT policy for anon with no row condition", () => {
        const findings = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "anon_insert", { command: "INSERT", roles: ["anon"] })
            ])
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("high");
        expect(findings[0].confidence).toBe("certain");
        expect(findings[0].title).toContain("insert");
        expect(findings[0].fix).toContain("REVOKE INSERT");
    });

    it("flags a FOR ALL policy with USING (true) and reports every granted write", () => {
        const [f] = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "anon_all", {
                    command: "ALL",
                    roles: ["public"],
                    using: "true",
                    withCheck: "true"
                })
            ])
        );

        expect(f.title).toContain("insert, update and delete");
    });

    it("does NOT flag a correctly scoped anon policy — the Supabase default shape", () => {
        const findings = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "own_rows", {
                    command: "INSERT",
                    roles: ["anon"],
                    withCheck: "(user_id = auth.uid())"
                })
            ])
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a wide-open policy with no matching grant", () => {
        const findings = anonymousWriteAllowed.run(
            scenario(
                [policy("public", "comments", "anon_insert", { command: "INSERT", roles: ["anon"] })],
                [grant("public", "comments", "anon", ["SELECT"])]
            )
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a SELECT policy", () => {
        const findings = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "anon_read", {
                    command: "SELECT",
                    roles: ["anon"],
                    using: "true"
                })
            ])
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a write policy aimed only at authenticated callers", () => {
        const findings = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "auth_insert", {
                    command: "INSERT",
                    roles: ["authenticated"]
                })
            ])
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a restrictive policy", () => {
        const findings = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "gate", {
                    command: "INSERT",
                    roles: ["anon"],
                    permissive: false
                })
            ])
        );

        expect(findings).toEqual([]);
    });
});
