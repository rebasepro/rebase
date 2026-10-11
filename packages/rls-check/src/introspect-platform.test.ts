/**
 * Roles are cluster-wide; schemas belong to one database. Keyed on the
 * `rebase_user` role, any database on a server that also hosted a Rebase app
 * was labelled Rebase: fixes printed `rebase.uid()`, which does not exist
 * there, and uid tautologies were graded critical.
 */
import { describe, expect, it } from "vitest";

import { detectPlatform } from "./introspect";
import type { DbRole } from "./types";

const role = (name: string): DbRole => ({ name, canLogin: false, superuser: false, bypassRls: false, memberOf: [] });

describe("detectPlatform", () => {
    it("does not call a database Rebase because the cluster has a rebase_user role", () => {
        expect(detectPlatform(["public"], [role("rebase_user"), role("postgres")])).toBe("unknown");
    });

    it("calls a database with the rebase schema Rebase", () => {
        expect(detectPlatform(["public", "rebase"], [role("rebase_user")])).toBe("rebase");
    });

    it("still reads Supabase first", () => {
        expect(detectPlatform(["public", "auth", "storage"], [role("anon"), role("rebase_user")])).toBe("supabase");
    });
});
