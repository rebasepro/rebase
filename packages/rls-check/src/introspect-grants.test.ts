/**
 * Column-level privileges are privileges.
 *
 * Grants were read from `pg_class.relacl` only, so `GRANT SELECT (id, email)
 * ON users TO anon` on a table with RLS off produced no `rls-disabled`
 * finding, and Supabase's documented column-level UPDATE pattern next to a
 * `FOR UPDATE TO anon USING (true)` policy produced no
 * `anonymous-write-allowed` finding. The privilege is there either way; which
 * columns it covers changes how much leaks, not whether anything does.
 */
import { describe, expect, it } from "vitest";

import { grant, snapshot, table } from "../test/fixtures/snapshot";
import { rlsDisabled } from "./checks/rls-disabled";
import { readGrants, type Reader } from "./introspect";

const reader = (rows: Record<string, Record<string, unknown>[]>, asked: string[] = []): Reader => ({
    async query<R extends Record<string, unknown>>(what: string): Promise<R[]> {
        asked.push(what);
        return (rows[what] ?? []) as R[];
    }
});

describe("readGrants", () => {
    it("reads column privileges as well as table privileges", async () => {
        const asked: string[] = [];
        const grants = await readGrants(
            reader(
                {
                    "table privileges": [
                        { schema: "public", table_name: "users", grantee: "postgres", privilege_type: "SELECT" }
                    ],
                    "column privileges": [
                        { schema: "public", table_name: "users", grantee: "anon", privilege_type: "SELECT" },
                        { schema: "public", table_name: "users", grantee: "anon", privilege_type: "SELECT" },
                        { schema: "public", table_name: "users", grantee: "anon", privilege_type: "UPDATE" }
                    ]
                },
                asked
            ),
            ["public"]
        );

        expect(asked).toEqual(["table privileges", "column privileges"]);
        expect(grants).toContainEqual({ schema: "public", table: "users", grantee: "anon", privileges: ["SELECT", "UPDATE"] });
    });

    it("names each privilege once when a role holds it on the table and on a column", async () => {
        const grants = await readGrants(
            reader({
                "table privileges": [
                    { schema: "public", table_name: "users", grantee: "anon", privilege_type: "SELECT" }
                ],
                "column privileges": [
                    { schema: "public", table_name: "users", grantee: "anon", privilege_type: "SELECT" }
                ]
            }),
            ["public"]
        );

        expect(grants).toEqual([{ schema: "public", table: "users", grantee: "anon", privileges: ["SELECT"] }]);
    });
});

describe("a column grant on a table without RLS", () => {
    it("is reported by rls-disabled", () => {
        const findings = rlsDisabled.run(
            snapshot({
                relations: [table("public", "users", { columns: ["id", "email"] })],
                grants: [grant("public", "users", "anon", ["SELECT"])]
            })
        );
        expect(findings).toHaveLength(1);
    });
});
