/**
 * The API-key panel reads scopes back to a person and builds the scope list a
 * new key is minted with. Both have to say what the server enforces — the
 * vocabulary is `@rebasepro/types`' `scopes.ts`, and these pin the shaping the
 * panel adds on top of it:
 *
 * 1. A qualified scope is the same grant narrowed, not a different one:
 *    `data:read:posts` and `data:read:authors` are one "Read data" row on two
 *    collections, and `data:read` beside them widens that row to all of them.
 * 2. The picker never offers what the server would refuse — a scope the
 *    caller does not hold, or key management — and never sends a scope it
 *    was told to narrow to nothing.
 */

import {
    BUILT_IN_SCOPE_DESCRIPTIONS,
    BUILT_IN_SCOPES,
    DEFAULT_STORAGE_SOURCE_KEY,
    summarizeScopes,
    type ScopeSummary
} from "@rebasepro/types";
import type { RebaseTranslations } from "@rebasepro/cms-types";
import { de } from "../../app/src/locales/de";
import { en } from "../../app/src/locales/en";
import { es } from "../../app/src/locales/es";
import { fr } from "../../app/src/locales/fr";
import { hi } from "../../app/src/locales/hi";
import { it as italian } from "../../app/src/locales/it";
import { pt } from "../../app/src/locales/pt";

import {
    buildScopeList,
    combineRoles,
    defaultSelection,
    expiresAtFor,
    functionNamesFrom,
    grantableScopes,
    groupKeyScopes,
    incompleteScopes,
    isPersonalKeysDisabled,
    rateLimitFrom,
    readKeyError,
    readScopeListing,
    splitList
} from "../src/components/ApiKeys/scopes";
import {
    heldScopeLine,
    keyErrorTitle,
    localizeScopes,
    scopeDescriptionKey,
    scopeLabelKey,
    targetLabel
} from "../src/components/ApiKeys/scope-words";

const appScope: ScopeSummary = {
    scope: "project:deploy",
    label: "Deploy projects",
    description: "Ship a project to production.",
    target: "project",
    plane: "app"
};
const catalogue: ScopeSummary[] = [...summarizeScopes(), appScope];

describe("groupKeyScopes", () => {
    it("groups by plane in the order data, admin, app", () => {
        const groups = groupKeyScopes(["project:deploy", "logs:read", "data:read"], catalogue);
        expect(groups.map(group => group.plane)).toEqual(["data", "admin", "app"]);
    });

    it("folds a scope's targets into one row narrowed to them", () => {
        const [data] = groupKeyScopes(["data:read:posts", "data:read:authors"], catalogue);
        expect(data.scopes).toHaveLength(1);
        expect(data.scopes[0]).toMatchObject({
            scope: "data:read",
            label: "Read data",
            targetKind: "collection",
            targets: ["posts", "authors"]
        });
    });

    it("lets the unqualified grant win over its narrowed siblings", () => {
        const [data] = groupKeyScopes(["data:read:posts", "data:read"], catalogue);
        expect(data.scopes[0].targets).toBe("all");
    });

    it("orders rows as the catalogue lists them, not as the key stored them", () => {
        const [data] = groupKeyScopes(["functions:invoke", "data:delete", "data:read"], catalogue);
        expect(data.scopes.map(entry => entry.scope)).toEqual(["data:read", "data:delete", "functions:invoke"]);
    });

    it("labels app scopes from the catalogue and keeps their targets", () => {
        const groups = groupKeyScopes(["project:deploy:alpha"], catalogue);
        expect(groups).toEqual([{
            plane: "app",
            scopes: [{
                scope: "project:deploy",
                label: "Deploy projects",
                description: "Ship a project to production.",
                plane: "app",
                targetKind: "project",
                targets: ["alpha"]
            }]
        }]);
    });

    it("keeps a scope the catalogue no longer knows, under its own name", () => {
        const groups = groupKeyScopes(["data:read", "billing:export"], catalogue);
        const app = groups.find(group => group.plane === "app");
        expect(app?.scopes[0]).toMatchObject({ scope: "billing:export", label: "billing:export", targets: "all" });
    });

    it("still places built-in scopes without a catalogue", () => {
        const groups = groupKeyScopes(["users:read", "storage:write:(default)"]);
        expect(groups.map(group => group.plane)).toEqual(["data", "admin"]);
        expect(groups[0].scopes[0]).toMatchObject({ scope: "storage:write", targets: ["(default)"] });
    });

    it("has nothing to show for a key with no scopes", () => {
        expect(groupKeyScopes([], catalogue)).toEqual([]);
    });
});

describe("grantableScopes", () => {
    it("offers only what the caller holds", () => {
        const offered = grantableScopes(catalogue, ["data:read", "data:write", "logs:read"]).map(s => s.scope);
        expect(offered).toEqual(["data:read", "data:write", "logs:read"]);
    });

    it("offers a scope the caller holds on some targets only", () => {
        const offered = grantableScopes(catalogue, ["data:read:posts"]).map(s => s.scope);
        expect(offered).toEqual(["data:read"]);
    });

    it("never offers key management, even to an admin", () => {
        const everything = catalogue.map(summary => summary.scope);
        const offered = grantableScopes(catalogue, everything).map(s => s.scope);
        expect(offered).not.toContain("keys:read");
        expect(offered).not.toContain("keys:write");
        expect(offered).toContain("users:write");
        expect(offered).toContain("project:deploy");
    });
});

describe("defaultSelection", () => {
    it("opens on data:read across every collection", () => {
        expect(defaultSelection(catalogue)).toEqual({ "data:read": { mode: "all" } });
    });

    it("selects nothing when data:read is not on offer", () => {
        expect(defaultSelection([appScope])).toEqual({});
    });
});

describe("buildScopeList", () => {
    const order = catalogue.map(summary => summary.scope);

    it("sends a scope on every target unqualified", () => {
        expect(buildScopeList({ "data:read": { mode: "all" } }, order)).toEqual(["data:read"]);
    });

    it("sends a narrowed scope once per target", () => {
        expect(buildScopeList({ "data:write": { mode: "some", targets: ["posts", "authors"] } }, order))
            .toEqual(["data:write:posts", "data:write:authors"]);
    });

    it("drops blank and duplicate targets, and targets with spaces the server would refuse", () => {
        expect(buildScopeList({ "storage:read": { mode: "some", targets: [" (default) ", "", "(default)", "two words"] } }, order))
            .toEqual(["storage:read:(default)"]);
    });

    it("sends nothing for a scope narrowed to no target", () => {
        expect(buildScopeList({ "data:read": { mode: "all" }, "data:delete": { mode: "some", targets: [] } }, order))
            .toEqual(["data:read"]);
    });

    it("follows the catalogue order whatever order the boxes were ticked in", () => {
        expect(buildScopeList({
            "logs:read": { mode: "all" },
            "project:deploy": { mode: "some", targets: ["alpha"] },
            "data:read": { mode: "all" }
        }, order)).toEqual(["data:read", "logs:read", "project:deploy:alpha"]);
    });
});

describe("incompleteScopes", () => {
    it("names the scopes switched to some targets with none chosen", () => {
        expect(incompleteScopes({
            "data:read": { mode: "all" },
            "data:write": { mode: "some", targets: [] },
            "storage:read": { mode: "some", targets: ["  "] },
            "functions:invoke": { mode: "some", targets: ["resize"] }
        })).toEqual(["data:write", "storage:read"]);
    });
});

describe("splitList and combineRoles", () => {
    it("splits on commas and whitespace", () => {
        expect(splitList("alpha, beta  gamma,,alpha")).toEqual(["alpha", "beta", "gamma"]);
    });

    it("merges picked and typed roles without duplicates or service", () => {
        expect(combineRoles(["admin", "support"], "support, service auditor")).toEqual(["admin", "support", "auditor"]);
    });
});

describe("limits", () => {
    it("turns an expiry choice into an instant, or null for never", () => {
        const now = Date.UTC(2026, 0, 1);
        expect(expiresAtFor("never", now)).toBeNull();
        expect(expiresAtFor("7d", now)).toBe("2026-01-08T00:00:00.000Z");
        expect(expiresAtFor("1y", now)).toBe("2027-01-01T00:00:00.000Z");
    });

    it("reads a rate limit as a positive integer or the server default", () => {
        expect(rateLimitFrom("")).toBeNull();
        expect(rateLimitFrom("0")).toBeNull();
        expect(rateLimitFrom("250")).toBe(250);
        expect(rateLimitFrom("1,000")).toBe(1000);
    });
});

describe("server answers", () => {
    const apiError = (code: string, message: string) => Object.assign(new Error(message), { code, status: 403 });

    it("names a minting refusal by its code and keeps the server's message", () => {
        expect(readKeyError(apiError("SCOPE_EXCEEDS_CREATOR", "you do not hold logs:read")))
            .toEqual({ code: "SCOPE_EXCEEDS_CREATOR", message: "you do not hold logs:read" });
    });

    it("leaves any other failure unnamed", () => {
        expect(readKeyError(apiError("INTERNAL_ERROR", "boom"))).toEqual({ code: null, message: "boom" });
        expect(readKeyError("offline")).toEqual({ code: null, message: "offline" });
    });

    it("recognises personal keys switched off", () => {
        expect(isPersonalKeysDisabled(apiError("PERSONAL_KEYS_DISABLED", "off"))).toBe(true);
        expect(isPersonalKeysDisabled(apiError("FORBIDDEN", "no"))).toBe(false);
        expect(isPersonalKeysDisabled(null)).toBe(false);
    });

    it("reads the scope catalogue, and refuses what is not one", () => {
        expect(readScopeListing({ scopes: [appScope, { scope: 42 }], held: ["data:read"] }))
            .toEqual({ scopes: [appScope], held: ["data:read"] });
        expect(readScopeListing({ error: "not found" })).toBeNull();
        expect(readScopeListing({ scopes: [], held: [1] })).toBeNull();
    });

    it("reads function names from the function index", () => {
        expect(functionNamesFrom({ functions: [{ name: "resize", endpoint: "/functions/resize" }, { endpoint: "x" }] }))
            .toEqual(["resize"]);
        expect(functionNamesFrom(null)).toEqual([]);
    });
});

/**
 * Built-in scopes are worded by the panel, in its language; the keys are
 * derived from the scope, so a scope added to `BUILT_IN_SCOPES` without its two
 * keys in every locale would render the server's English in six of seven.
 */
describe("built-in scope translations", () => {
    const locales: Record<string, RebaseTranslations> = { en, es, de, fr, it: italian, pt, hi };

    it.each(Object.keys(locales))("%s words every built-in scope", (name) => {
        const locale = locales[name];
        const missing = BUILT_IN_SCOPES.flatMap(scope => [scopeLabelKey(scope), scopeDescriptionKey(scope)])
            .filter(key => !locale[key as keyof RebaseTranslations]);
        expect({ addTo: name, missing }).toEqual({ addTo: name, missing: [] });
    });

    it("says in English exactly what the server's catalogue says", () => {
        for (const scope of BUILT_IN_SCOPES) {
            expect([scope, en[scopeLabelKey(scope) as keyof typeof en]]).toEqual([scope, BUILT_IN_SCOPE_DESCRIPTIONS[scope].label]);
            expect([scope, en[scopeDescriptionKey(scope) as keyof typeof en]]).toEqual([scope, BUILT_IN_SCOPE_DESCRIPTIONS[scope].description]);
        }
    });

    it("derives the keys from the scope", () => {
        expect(scopeLabelKey("data:read")).toBe("studio_scope_data_read_label");
        expect(scopeDescriptionKey("functions:invoke")).toBe("studio_scope_functions_invoke_description");
    });
});

describe("localizeScopes", () => {
    const german = (key: string): string => de[key as keyof typeof de] ?? key;

    it("words built-in scopes in the panel's language", () => {
        const [read] = localizeScopes(german, catalogue);
        expect(read).toMatchObject({ scope: "data:read", label: "Daten lesen" });
        expect(read.description).toBe(de.studio_scope_data_read_description);
    });

    it("keeps an app scope as its app declared it", () => {
        const localized = localizeScopes(german, catalogue);
        expect(localized.find(summary => summary.scope === "project:deploy")).toEqual(appScope);
    });

    it("falls back to the server's wording for a built-in scope with no key", () => {
        const noKeys = (key: string) => key;
        const [read] = localizeScopes(noKeys, catalogue);
        expect(read).toMatchObject({ label: "Read data", description: BUILT_IN_SCOPE_DESCRIPTIONS["data:read"].description });
    });

    it("carries the translation through to a key's grouped scopes", () => {
        const [data] = groupKeyScopes(["data:read:posts"], localizeScopes(german, catalogue));
        expect(data.scopes[0].label).toBe("Daten lesen");
    });
});

describe("scope wording", () => {
    // Keys rendered as themselves, so the assertions read which string was asked for.
    const t = (key: string, vars?: Record<string, string | number>) =>
        vars ? `${key}(${Object.values(vars).join(",")})` : key;

    it("reads a scope on every target with the target kind's word", () => {
        const [data] = groupKeyScopes(["data:read"], catalogue);
        expect(heldScopeLine(t, data.scopes[0])).toBe("Read data — studio_api_keys_target_all_collection");
    });

    it("lists the targets a scope is narrowed to", () => {
        const [data] = groupKeyScopes(["data:write:posts", "data:write:authors"], catalogue);
        expect(heldScopeLine(t, data.scopes[0])).toBe("Create and update data — posts, authors");
    });

    it("names an app scope's own target kind", () => {
        const [app] = groupKeyScopes(["project:deploy"], catalogue);
        expect(heldScopeLine(t, app.scopes[0])).toBe("Deploy projects — studio_api_keys_target_all_other(project)");
    });

    it("leaves a scope that takes no target as its label", () => {
        const [admin] = groupKeyScopes(["logs:read"], catalogue);
        expect(heldScopeLine(t, admin.scopes[0])).toBe("Read server logs");
    });

    it("calls the default storage source the default bucket, and leaves other ids alone", () => {
        expect(targetLabel(t, "bucket", DEFAULT_STORAGE_SOURCE_KEY)).toBe("studio_api_keys_bucket_default");
        expect(targetLabel(t, "bucket", "uploads")).toBe("uploads");
        expect(targetLabel(t, "collection", DEFAULT_STORAGE_SOURCE_KEY)).toBe(DEFAULT_STORAGE_SOURCE_KEY);
    });

    it("titles each minting refusal by its rule", () => {
        expect(keyErrorTitle(t, "ROLE_EXCEEDS_CREATOR")).toBe("studio_api_keys_error_role_exceeds_creator");
        expect(keyErrorTitle(t, "KEY_MANAGEMENT_SCOPE")).toBe("studio_api_keys_error_key_management_scope");
        expect(keyErrorTitle(t, null)).toBe("studio_api_keys_error_generic");
    });
});
