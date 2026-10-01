/**
 * Schema USAGE, read from `pg_namespace.nspacl`.
 *
 * A role without USAGE on a schema cannot name anything in it, so a table
 * grant there reaches nothing. The scanner never read it, and reported a
 * table in a schema anon cannot use as a critical `rls-disabled`.
 */
import { describe, expect, it } from "vitest";

import { readSchemaUsage, type IntrospectDiagnostics, type Reader } from "./introspect";

const diagnostics = (): IntrospectDiagnostics => ({
    tlsVerificationDisabled: false,
    excludedSchemas: [],
    degraded: [],
    unrecognizedGrantees: []
});

describe("readSchemaUsage", () => {
    it("reads who holds USAGE on each schema", async () => {
        const asked: string[] = [];
        const reader: Reader = {
            async query<R extends Record<string, unknown>>(what: string, text: string): Promise<R[]> {
                asked.push(what);
                expect(text).toContain("nspacl");
                // An unset nspacl means the default: the owner, and nobody else.
                expect(text).toContain("acldefault('n'");
                const rows: Record<string, unknown>[] = [
                    { schema: "public", grantee: "PUBLIC" },
                    { schema: "internal", grantee: "postgres" }
                ];
                return rows as R[];
            }
        };

        expect(await readSchemaUsage(reader, diagnostics())).toEqual([
            { schema: "public", grantee: "PUBLIC" },
            { schema: "internal", grantee: "postgres" }
        ]);
        expect(asked).toEqual(["schema privileges"]);
    });

    it("answers 'unknown' rather than 'nobody' when the read failed", async () => {
        const diag = diagnostics();
        const reader: Reader = {
            async query<R extends Record<string, unknown>>(what: string): Promise<R[]> {
                diag.degraded.push({ what, error: "permission denied" });
                return [];
            }
        };

        // An empty list would read as "no role can use any schema" and silence
        // every grant-gated check; undefined makes every role count as able to.
        expect(await readSchemaUsage(reader, diag)).toBeUndefined();
    });
});
