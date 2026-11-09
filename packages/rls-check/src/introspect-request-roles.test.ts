/**
 * Rebase runs every request as one role, `rebase_user` unless the project
 * names another (`rls.requestRole`). The scan has to know which, or a project
 * on a shared cluster that runs as `acme_prod_user` scans as though nothing
 * could reach its tables.
 */
import { describe, expect, it } from "vitest";

import { exposedRolesFor, resolveRequestRoles } from "./introspect";
import type { DbRole } from "./types";

const role = (name: string): DbRole => ({ name, canLogin: false, superuser: false, bypassRls: false, memberOf: [] });

describe("resolveRequestRoles", () => {
    it("prefers the roles named with --request-role", () => {
        expect(resolveRequestRoles(["acme_prod_user"], "other_role")).toEqual(["acme_prod_user"]);
    });

    it("reads the roles a Rebase boot recorded in rebase.schema_meta", () => {
        expect(resolveRequestRoles(undefined, "authenticated, anon")).toEqual(["authenticated", "anon"]);
        expect(resolveRequestRoles([], "acme_prod_user")).toEqual(["acme_prod_user"]);
    });

    it("falls back to rebase_user", () => {
        expect(resolveRequestRoles(undefined, null)).toEqual(["rebase_user"]);
        expect(resolveRequestRoles(undefined, " ")).toEqual(["rebase_user"]);
    });
});

describe("exposedRolesFor", () => {
    const roles = [role("anon"), role("rebase_user"), role("acme_prod_user"), role("postgres")];

    it("adds the request role in place of rebase_user", () => {
        expect(exposedRolesFor(roles, ["acme_prod_user"])).toEqual(["PUBLIC", "anon", "acme_prod_user"]);
    });

    it("keeps rebase_user when it is the request role", () => {
        expect(exposedRolesFor(roles, ["rebase_user"])).toEqual(["PUBLIC", "anon", "rebase_user"]);
    });

    it("still adds the roles named with --role and the connecting role", () => {
        expect(exposedRolesFor(roles, ["rebase_user"], ["postgres"])).toEqual(["PUBLIC", "anon", "rebase_user", "postgres"]);
    });
});
