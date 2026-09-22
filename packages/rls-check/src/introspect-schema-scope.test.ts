/**
 * Which schemas a default scan covers.
 *
 * `rebase` used to be excluded as a "platform" schema, alongside Supabase's
 * `auth` and `storage`. The analogy did not hold: Supabase's platform schemas
 * are not reachable by the role an API request arrives as, while `rebase` held
 * `refresh_tokens`, `mfa_factors` and `api_keys` with RLS off and full DML
 * granted to `rebase_user` — precisely the `rls-disabled` condition — and the
 * exclusion is the reason no scan ever reported it.
 *
 * These pin the scope so re-adding it is a test failure rather than a one-line
 * diff nobody reads.
 */
import { describe, it, expect } from "vitest";
import { selectSchemas, UnknownSchemaError } from "./introspect";
import type { IntrospectDiagnostics } from "./introspect";

const diagnostics = (): IntrospectDiagnostics => ({
    tlsVerificationDisabled: false,
    excludedSchemas: [],
    unrecognizedGrantees: [],
    degraded: []
});

describe("default schema scope", () => {
    it("scans the rebase schema", () => {
        const kept = selectSchemas(["public", "rebase", "drizzle"], undefined, diagnostics());
        expect(kept).toContain("rebase");
    });

    it("still skips migration bookkeeping and third-party platform schemas", () => {
        const kept = selectSchemas(
            ["public", "rebase", "drizzle", "storage", "vault", "pgsodium"],
            undefined,
            diagnostics()
        );
        expect(kept).toEqual(["public", "rebase"]);
    });

    it("skips system schemas", () => {
        const kept = selectSchemas(["public", "pg_catalog", "information_schema", "pg_toast"], undefined, diagnostics());
        expect(kept).toEqual(["public"]);
    });

    it("honours an explicit --schema list over every default", () => {
        const d = diagnostics();
        const kept = selectSchemas(["public", "rebase", "storage"], ["storage"], d);
        expect(kept).toEqual(["storage"]);
        expect(d.excludedSchemas.map(e => e.schema).sort()).toEqual(["public", "rebase"]);
    });
});

/**
 * An unknown `--schema` used to scan nothing: 0 tables, "No findings", exit 0,
 * for as long as the typo sat in CI. `--role`, `--only` and `--skip` refuse a
 * name that matches nothing for exactly this reason, and so does `--schema`.
 */
describe("a requested schema that does not exist", () => {
    it("is refused, not quietly dropped", () => {
        expect(() => selectSchemas(["public", "app"], ["pubic"], diagnostics())).toThrow(UnknownSchemaError);
    });

    it("names every unknown schema, and only those", () => {
        try {
            selectSchemas(["public", "app"], ["app", "Public", "pubic"], diagnostics());
            throw new Error("expected a refusal");
        } catch (error) {
            expect(error).toBeInstanceOf(UnknownSchemaError);
            expect((error as UnknownSchemaError).schemas).toEqual(["Public", "pubic"]);
        }
    });

    it("is not claimed when the schema list itself could not be read", () => {
        const d = diagnostics();
        d.degraded.push({ what: "schema list", error: "permission denied" });
        expect(selectSchemas([], ["public"], d)).toEqual([]);
    });
});
