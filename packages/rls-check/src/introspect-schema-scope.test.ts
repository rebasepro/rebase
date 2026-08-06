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
import { selectSchemas } from "./introspect";
import type { IntrospectDiagnostics } from "./introspect";

const diagnostics = (): IntrospectDiagnostics => ({
    tlsVerificationDisabled: false,
    excludedSchemas: [],
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
