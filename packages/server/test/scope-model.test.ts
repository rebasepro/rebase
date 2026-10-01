/**
 * The scope vocabulary, as `@rebasepro/types` defines it and the server
 * builds on it: parsing, matching, the "never more than the minter" set
 * arithmetic, what a person holds, the reading of keys stored before scopes,
 * and the access-model declarations boot refuses.
 */
import { describe, it, expect } from "@jest/globals";
import {
    ADMIN_SCOPES,
    DATA_PLANE_SCOPES,
    describeScope,
    intersectScopes,
    parseScope,
    scopeGrants,
    scopeGrantsAny,
    scopesBeyond,
    scopesForRoles,
    scopeTargets,
    summarizeRoles,
    summarizeScopes,
    validateScopes,
    type AccessModel,
    type CollectionConfig
} from "@rebasepro/types";
import { scopesFromStoredPermissions, parseStoredPermissions } from "../src/auth/api-keys/legacy-permissions";
import { accessModelFromCollections, AccessModelError } from "../src/auth/access";
import { httpMethodToOperation } from "../src/auth/api-keys/http-operation";

const MODEL: AccessModel = {
    roles: { support: { name: "Support", scopes: ["users:read", "users:write"] } },
    scopes: { "project:deploy": { label: "Deploy projects", target: "project" } }
};

describe("parseScope", () => {
    it.each([
        ["data:read", { scope: "data:read" }],
        ["data:read:posts", { scope: "data:read", target: "posts" }],
        ["functions:invoke:a:b", { scope: "functions:invoke", target: "a:b" }],
        ["project:deploy:p-1", { scope: "project:deploy", target: "p-1" }]
    ])("reads %s", (value, parsed) => {
        expect(parseScope(value)).toEqual(parsed);
    });

    it.each(["data", "data:", ":read", "Data:read", "data:read:", "data:read:has space", "*", ""])(
        "refuses %j", (value) => {
            expect(parseScope(value)).toBeNull();
        });
});

describe("scopeGrants", () => {
    it("lets the unqualified scope cover every target", () => {
        expect(scopeGrants(["data:read"], "data:read")).toBe(true);
        expect(scopeGrants(["data:read"], "data:read", "posts")).toBe(true);
    });

    it("lets a qualified scope cover its own target only", () => {
        expect(scopeGrants(["data:read:posts"], "data:read", "posts")).toBe(true);
        expect(scopeGrants(["data:read:posts"], "data:read", "comments")).toBe(false);
    });

    it("never answers an unqualified question with a qualified grant", () => {
        expect(scopeGrants(["data:read:posts"], "data:read")).toBe(false);
        expect(scopeGrantsAny(["data:read:posts"], "data:read")).toBe(true);
    });

    it("does not let one action stand in for another", () => {
        expect(scopeGrants(["data:write"], "data:read", "posts")).toBe(false);
        expect(scopeGrants(["data:read"], "data:readx")).toBe(false);
    });

    it("lists the targets a set narrows a scope to", () => {
        expect(scopeTargets(["data:read"], "data:read")).toBe("all");
        expect(scopeTargets(["data:read:a", "data:read:b", "data:write:c"], "data:read")).toEqual(["a", "b"]);
    });
});

describe("never more than the minter", () => {
    it("finds what a request holds beyond the minter", () => {
        expect(scopesBeyond(["data:read:posts", "logs:read"], ["data:read"])).toEqual(["logs:read"]);
        expect(scopesBeyond(["data:read"], ["data:read:posts"])).toEqual(["data:read"]);
        expect(scopesBeyond(["not a scope"], ["data:read"])).toEqual(["not a scope"]);
    });

    it("narrows a personal key to what its owner still holds", () => {
        expect(intersectScopes(["data:read", "logs:read"], ["data:read"])).toEqual(["data:read"]);
    });
});

describe("what a person holds", () => {
    it("holds the data plane and every app scope with no role at all", () => {
        expect(scopesForRoles([], MODEL).sort()).toEqual([...DATA_PLANE_SCOPES, "project:deploy"].sort());
    });

    it("holds the whole admin plane with the admin role", () => {
        const held = scopesForRoles(["admin"], MODEL);
        for (const scope of ADMIN_SCOPES) expect(held).toContain(scope);
    });

    it("holds a declared role's scopes, and nothing for an undeclared one", () => {
        expect(scopesForRoles(["support"], MODEL)).toEqual(expect.arrayContaining(["users:read", "users:write"]));
        expect(scopesForRoles(["editor"], MODEL)).not.toContain("users:read");
    });

    it("is not fooled by a role named after an object prototype member", () => {
        expect(() => scopesForRoles(["constructor", "__proto__", "toString"], MODEL)).not.toThrow();
        expect(scopesForRoles(["constructor"], MODEL)).not.toContain("users:read");
    });
});

describe("validateScopes", () => {
    it("accepts built-ins, app scopes and targets where a scope takes one", () => {
        expect(validateScopes(["data:read:posts", "logs:read", "project:deploy:p1", "functions:invoke:x"], MODEL)).toEqual([]);
    });

    it("names every problem", () => {
        expect(validateScopes(["logs:read:x", "data:wipe", "nope", 7], MODEL)).toEqual([
            { scope: "logs:read:x", reason: "target-not-accepted" },
            { scope: "data:wipe", reason: "unknown" },
            { scope: "nope", reason: "malformed" },
            { scope: "7", reason: "malformed" }
        ]);
    });
});

describe("describing scopes for a person", () => {
    it("words built-ins, app scopes and targets", () => {
        expect(describeScope("data:read:posts").label).toBe("Read data: posts");
        expect(describeScope("project:deploy", MODEL).label).toBe("Deploy projects");
        expect(describeScope("unknown:thing").label).toBe("unknown:thing");
    });

    it("lists admin first among roles, and every scope by plane", () => {
        expect(summarizeRoles(MODEL).map(role => role.id)).toEqual(["admin", "support"]);
        const planes = Object.fromEntries(summarizeScopes(MODEL).map(s => [s.scope, s.plane]));
        expect(planes["data:read"]).toBe("data");
        expect(planes["keys:write"]).toBe("admin");
        expect(planes["project:deploy"]).toBe("app");
    });
});

describe("httpMethodToOperation", () => {
    it.each([["GET", "read"], ["head", "read"], ["OPTIONS", "read"], ["POST", "write"], ["put", "write"],
        ["PATCH", "write"], ["DELETE", "delete"]])("maps %s to %s", (method, operation) => {
        expect(httpMethodToOperation(method)).toBe(operation);
    });

    it("treats a method it does not know as a write, not a read", () => {
        expect(httpMethodToOperation("PROPFIND")).toBe("write");
    });
});

describe("keys stored before scopes", () => {
    const read = (permissions: unknown, admin = false) =>
        scopesFromStoredPermissions(parseStoredPermissions(permissions), admin);

    it("narrows a collection grant to that collection", () => {
        expect(read([{ collection: "posts", operations: ["read", "delete"] }])).toEqual({
            scopes: ["data:read:posts", "data:delete:posts"], roles: []
        });
    });

    it("reads the wildcard as the whole data plane", () => {
        expect(read([{ collection: "*", operations: ["read", "write", "delete"] }]).scopes.sort()).toEqual(
            [...DATA_PLANE_SCOPES].sort());
    });

    it("gives a read-only wildcard no function calls", () => {
        expect(read([{ collection: "*", operations: ["read"] }]).scopes).toEqual(["data:read", "storage:read"]);
    });

    it("reads the storage and functions namespaces", () => {
        expect(read([{ collection: "storage", operations: ["read"] }]).scopes).toEqual(["storage:read"]);
        expect(read([{ collection: "functions", operations: ["write"] }]).scopes).toEqual(["functions:invoke"]);
        expect(read([{ collection: "functions/send", operations: ["write"] }]).scopes).toEqual(["functions:invoke:send"]);
        expect(read([{ collection: "functions/send", operations: ["read"] }]).scopes).toEqual([]);
    });

    it("reads the admin flag as the admin role and the surfaces it reached — never database or keys", () => {
        const { scopes, roles } = read([], true);
        expect(roles).toEqual(["admin"]);
        expect(scopes).toEqual(expect.arrayContaining(["users:write", "schema:write", "logs:read", "cron:write", "backups:read"]));
        expect(scopes.some(scope => scope.startsWith("database:") || scope.startsWith("keys:"))).toBe(false);
    });

    it("survives JSON text and junk", () => {
        expect(read('[{"collection":"posts","operations":["read"]}]').scopes).toEqual(["data:read:posts"]);
        expect(read("not json").scopes).toEqual([]);
        expect(read([{ collection: 3 }, null, { collection: "posts", operations: ["drop"] }]).scopes).toEqual([]);
    });
});

describe("the access model boot accepts", () => {
    const users = (auth: object): CollectionConfig => ({ slug: "users", name: "Users", properties: {}, auth } as unknown as CollectionConfig);

    it("is built-ins only when nothing is declared", () => {
        expect(accessModelFromCollections([])).toEqual({ roles: {}, scopes: {} });
        expect(accessModelFromCollections([users(true)])).toEqual({ roles: {}, scopes: {} });
    });

    it("reads roles and app scopes off the users collection", () => {
        const model = accessModelFromCollections([users({
            enabled: true,
            roles: { support: { scopes: ["users:read", "project:deploy"] } },
            scopes: { "project:deploy": { label: "Deploy" } }
        })]);
        expect(model.roles.support.scopes).toEqual(["users:read", "project:deploy"]);
        expect(Object.keys(model.scopes)).toEqual(["project:deploy"]);
    });

    it.each([
        ["declares admin", { roles: { admin: { scopes: [] } } }, /built in/],
        ["gives a role a data-plane scope", { roles: { editor: { scopes: ["data:write"] } } }, /securityRules/],
        ["gives a role an unknown scope", { roles: { editor: { scopes: ["logs:wipe"] } } }, /logs:wipe/],
        ["gives a role no scopes list", { roles: { editor: {} } }, /scopes list/],
        ["reuses a built-in resource", { scopes: { "logs:export": { label: "Export logs" } } }, /built-in resource "logs"/],
        ["names an app scope with a target", { scopes: { "project:deploy:x": { label: "x" } } }, /not a scope name/],
        ["names an app scope badly", { scopes: { "Deploy": { label: "x" } } }, /not a scope name/],
        ["leaves an app scope unlabelled", { scopes: { "project:deploy": { label: " " } } }, /needs a label/]
    ])("refuses a model that %s", (_label, auth, message) => {
        expect(() => accessModelFromCollections([users({ enabled: true, ...auth })])).toThrow(AccessModelError);
        expect(() => accessModelFromCollections([users({ enabled: true, ...auth })])).toThrow(message);
    });
});
