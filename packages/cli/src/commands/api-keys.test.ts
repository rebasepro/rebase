/**
 * What `rebase api-keys` is actually about to do.
 *
 * `create` and `revoke` read a positional — the key's name, and the id of the
 * key to delete — and both parsed the line the way `auth reset-password` used
 * to: `arg` in permissive mode over `rawArgs.slice(4)`. That is wrong twice.
 *
 *   rebase api-keys revoke --foo          → DELETE /api/admin/api-keys/--foo
 *   rebase api-keys create --debug …      → a key named "--debug"
 *   rebase --debug api-keys revoke <id>   → revokes the key named "revoke"
 *
 * None of these are hypothetical: `--debug` is what `bin/rebase.js` prints
 * after every failure as the thing to re-run with, so it is the likeliest token
 * to be appended to a command that has just failed — and on `create` it names a
 * credential that is then handed out.
 *
 * And what a key may do is a list of scopes: named on the line, or every one
 * the caller holds (`--full-access`) less key management. The flags of the
 * permission model before it are refused by name with their replacement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiKeyMasked, ScopeSummary } from "@rebasepro/types";
import { RebaseApiError } from "@rebasepro/client";

vi.mock("../utils/project", async importOriginal => {
    const actual = await importOriginal<typeof import("../utils/project")>();
    return {
        ...actual,
        requireProjectRoot: () => "/nonexistent/rebase-api-keys-test",
        readEnvFile: () => ({
            SERVICE_KEY: "svc_test_key",
            REBASE_BASE_URL: "http://rebase.test"
        })
    };
});

import {
    apiKeysCommand,
    CREATE_KEY_FLAGS,
    describeFailure,
    describeKey,
    describeScopes,
    GET_KEY_FLAGS,
    grantableScopes,
    RETIRED_CREATE_OPTIONS,
    REVOKE_KEY_FLAGS,
    resolveCreateKeyArgs,
    resolveGetKeyArgs,
    resolveRevokeKeyArgs
} from "./api-keys";

/** A full `process.argv`, the way `cli.ts` hands it to a command. */
function argv(...line: string[]): string[] {
    return ["/usr/bin/node", "/usr/local/bin/rebase", ...line];
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (lines: string[]) => lines.join("\n").replace(ANSI, "");

function maskedKey(overrides: Partial<ApiKeyMasked> = {}): ApiKeyMasked {
    return {
        id: "key_1",
        name: "Blog CI",
        kind: "service",
        key_prefix: "rk_live_abcd",
        scopes: ["data:read:posts", "data:write:posts"],
        roles: [],
        owner_uid: null,
        rate_limit: null,
        created_by: "service",
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
        ...overrides
    };
}

describe("resolveRevokeKeyArgs", () => {
    it("reads the id as a positional or as --id", () => {
        expect(resolveRevokeKeyArgs(argv("api-keys", "revoke", "key_123"))).toEqual({ id: "key_123" });
        expect(resolveRevokeKeyArgs(argv("api-keys", "revoke", "--id", "key_123"))).toEqual({ id: "key_123" });
    });

    it("refuses an undeclared flag rather than sending a DELETE for it", () => {
        expect(() => resolveRevokeKeyArgs(argv("api-keys", "revoke", "--foo")))
            .toThrow(/unknown or unexpected option/);
    });

    it("does not take --debug for the key to revoke", () => {
        expect(resolveRevokeKeyArgs(argv("api-keys", "revoke", "--debug"))).toEqual({ id: undefined });
    });

    it("is not shifted by a flag placed before the command", () => {
        // `slice(4)` started at "revoke", so the id was the word "revoke".
        expect(resolveRevokeKeyArgs(argv("--debug", "api-keys", "revoke", "key_123")))
            .toEqual({ id: "key_123" });
    });

    it("refuses more arguments than it takes", () => {
        expect(() => resolveRevokeKeyArgs(argv("api-keys", "revoke", "key_123", "key_456")))
            .toThrow(/takes 1 argument/);
    });

    it("names the command's help in the error", () => {
        expect(() => resolveRevokeKeyArgs(argv("api-keys", "revoke", "--wat")))
            .toThrow(/rebase api-keys revoke --help/);
    });
});

describe("resolveGetKeyArgs", () => {
    it("reads the id as a positional or as --id, and nothing else", () => {
        expect(resolveGetKeyArgs(argv("api-keys", "get", "key_123"))).toEqual({ id: "key_123" });
        expect(resolveGetKeyArgs(argv("api-keys", "get", "--id", "key_123"))).toEqual({ id: "key_123" });
        expect(() => resolveGetKeyArgs(argv("api-keys", "get", "--wat"))).toThrow(/rebase api-keys get --help/);
    });
});

describe("resolveCreateKeyArgs", () => {
    const NOW = new Date("2026-10-01T00:00:00.000Z");
    const create = (...line: string[]) => resolveCreateKeyArgs(argv("api-keys", "create", ...line), NOW);

    it("reads the name as a positional, as --name, or as -n", () => {
        expect(create("Analytics", "--scopes", "data:read").name).toBe("Analytics");
        expect(create("--name", "Analytics", "--scopes", "data:read").name).toBe("Analytics");
        expect(create("-n", "Analytics", "--scopes", "data:read").name).toBe("Analytics");
    });

    it("does not name a credential after a flag", () => {
        // `--debug` is consumed as the global flag, so there is no name at all —
        // and no key is minted without one.
        expect(() => create("--debug", "--full-access")).toThrow(/needs a name/);
        expect(() => create("--foo", "--full-access")).toThrow(/unknown or unexpected option/);
    });

    it("is not shifted by a flag placed before the command", () => {
        expect(resolveCreateKeyArgs(argv("--debug", "api-keys", "create", "Analytics", "--scopes", "data:read"), NOW).name)
            .toBe("Analytics");
    });

    it("takes scopes comma-separated, repeated, or both — trimmed and deduplicated", () => {
        expect(create("CI", "--scopes", "data:read:posts,data:write:posts", "--scopes", "logs:read", "--scopes", "data:read:posts").scopes)
            .toEqual(["data:read:posts", "data:write:posts", "logs:read"]);
        expect(create("CI", "--scopes=data:read, storage:read:(default)").scopes)
            .toEqual(["data:read", "storage:read:(default)"]);
    });

    it("takes RLS roles the same way, and none unless asked", () => {
        expect(create("CI", "--scopes", "data:read", "--roles", "admin,editor", "--roles", "admin").roles)
            .toEqual(["admin", "editor"]);
        expect(create("CI", "--scopes", "data:read").roles).toEqual([]);
    });

    it("reads --full-access as every scope the caller holds, to be fetched", () => {
        expect(create("CI", "--full-access").scopes).toBe("held");
    });

    it("refuses --scopes and --full-access together", () => {
        expect(() => create("CI", "--full-access", "--scopes", "data:read")).toThrow(/not both/);
    });

    it("never defaults what a key may do", () => {
        expect(() => create("CI")).toThrow(/--scopes .*--full-access/);
    });

    it.each([
        ["--permissions", ["--permissions", '[{"collection":"*","operations":["read"]}]'], /--permissions is gone: .*--scopes data:read:posts/],
        ["--permissions=…", ['--permissions=[{"collection":"posts","operations":["read"]}]'], /--permissions is gone/],
        ["--admin", ["--admin"], /--admin is gone: .*--roles admin/],
        ["--expires", ["--expires", "90d"], /--expires is gone: .*--expires-in/]
    ])("refuses %s by name, with its replacement", (_label, flags, message) => {
        expect(() => create("CI", "--scopes", "data:read", ...flags)).toThrow(message);
        // Wherever it sits on the line — first is where a pasted old command puts it.
        expect(() => resolveCreateKeyArgs(argv("api-keys", "create", ...flags, "CI"), NOW)).toThrow(message);
    });

    it("expires a key in whole days, or at a date in the future", () => {
        expect(create("CI", "--scopes", "data:read", "--expires-in", "30").expires_at)
            .toBe("2026-10-31T00:00:00.000Z");
        expect(create("CI", "--scopes", "data:read", "--expires-at", "2027-01-31").expires_at)
            .toBe("2027-01-31T00:00:00.000Z");
        expect(create("CI", "--scopes", "data:read").expires_at).toBeNull();

        expect(() => create("CI", "--scopes", "data:read", "--expires-in", "90d")).toThrow(/whole number of days/);
        expect(() => create("CI", "--scopes", "data:read", "--expires-in", "0")).toThrow(/whole number of days/);
        expect(() => create("CI", "--scopes", "data:read", "--expires-at", "soon")).toThrow(/ISO date/);
        expect(() => create("CI", "--scopes", "data:read", "--expires-at", "2020-01-01")).toThrow(/in the future/);
        expect(() => create("CI", "--scopes", "data:read", "--expires-in", "30", "--expires-at", "2027-01-31"))
            .toThrow(/not both/);
    });

    it("takes a positive whole rate limit, and refuses one JSON would turn into null", () => {
        expect(create("CI", "--scopes", "data:read", "--rate-limit", "50").rate_limit).toBe(50);
        expect(create("CI", "--scopes", "data:read").rate_limit).toBeNull();
        // `Number("abc")` is NaN, and `JSON.stringify` writes NaN as null — the
        // server default, silently. Refused here instead.
        expect(() => create("CI", "--scopes", "data:read", "--rate-limit", "abc")).toThrow(/--rate-limit/);
        expect(() => create("CI", "--scopes", "data:read", "--rate-limit", "0")).toThrow(/--rate-limit/);
    });
});

describe("grantableScopes", () => {
    it("is everything held except key management, targeted or not", () => {
        expect(grantableScopes([
            "data:read", "data:write", "logs:read", "keys:read", "keys:write", "keys:read:x", "project:deploy"
        ])).toEqual(["data:read", "data:write", "logs:read", "project:deploy"]);
    });
});

describe("describeKey", () => {
    it("shows a service key's kind, scopes and the roles it runs as", () => {
        const text = plain(describeKey(maskedKey({ roles: ["admin"], rate_limit: 50 })));
        expect(text).toMatch(/Kind:\s+service/);
        expect(text).toMatch(/Scopes:\s+data:read:posts, data:write:posts/);
        expect(text).toMatch(/Roles:\s+service, admin/);
        expect(text).toMatch(/Rate limit:\s+50/);
    });

    it("says a personal key runs as its owner", () => {
        const text = plain(describeKey(maskedKey({ kind: "personal", owner_uid: "user_9" })));
        expect(text).toMatch(/Kind:\s+personal/);
        expect(text).toMatch(/Roles:\s+its owner's \(user_9\)/);
    });
});

describe("describeFailure", () => {
    it("shows the server's code, status and message", () => {
        const error = new RebaseApiError(
            "A key cannot hold more than the account creating it, and you do not hold logs:read.",
            { status: 403, code: "SCOPE_EXCEEDS_CREATOR", details: { scopes: ["logs:read"] } }
        );
        expect(plain(describeFailure("Failed to create API key", error, "http://rebase.test")))
            .toBe("✗ Failed to create API key — SCOPE_EXCEEDS_CREATOR (403): A key cannot hold more than the account creating it, and you do not hold logs:read.");
    });

    it("lists what a scope may target when the one named does not exist", () => {
        const error = new RebaseApiError("These scopes name something this backend does not serve: data:read:pots.", {
            status: 400,
            code: "UNKNOWN_SCOPE_TARGET",
            details: { scopes: ["data:read:pots"], collections: ["posts", "authors"], buckets: ["default"], functions: [] }
        });
        const text = plain(describeFailure("Failed to create API key", error, "http://rebase.test"));
        expect(text).toContain("UNKNOWN_SCOPE_TARGET (400)");
        expect(text).toContain("Collections: posts, authors");
        expect(text).toContain("Buckets: default");
        expect(text).not.toContain("Functions:");
    });

    it("asks whether the server is running when there was no answer", () => {
        const error = new RebaseApiError("Could not reach the server at http://rebase.test/api/admin/api-keys: fetch failed", {
            status: 0,
            code: "NETWORK_ERROR"
        });
        expect(plain(describeFailure("Failed to list API keys", error, "http://rebase.test")))
            .toContain("Is the Rebase server running at http://rebase.test?");
    });
});

describe("describeScopes", () => {
    it("marks what the caller holds and flags key management", () => {
        const scopes: ScopeSummary[] = [
            { scope: "data:read", label: "Read data", description: "", target: "collection", plane: "data" },
            { scope: "logs:read", label: "Read server logs", description: "", plane: "admin" },
            { scope: "keys:write", label: "Manage service keys", description: "", plane: "admin" },
            { scope: "project:deploy", label: "Deploy projects", description: "", target: "project", plane: "app" }
        ];
        const text = plain(describeScopes(scopes, ["data:read", "keys:write", "project:deploy"]));
        expect(text).toMatch(/✓ data:read\s+Read data\s+:<collection>/);
        expect(text).toMatch(/ {3}logs:read\s+Read server logs/);
        expect(text).toMatch(/keys:write\s+Manage service keys\s+never on a key/);
        expect(text).toMatch(/App .*\n.*✓ project:deploy\s+Deploy projects\s+:<project>/);
    });
});

/**
 * The commands end to end, against a fake server behind the real SDK client:
 * which requests go out, and what is printed.
 */
describe("the commands against a server", () => {
    interface Sent { method: string; url: string; authorization: string | null; body: unknown }

    let sent: Sent[];
    let respond: (request: Sent) => Response;
    let printed: string[];
    let errors: string[];

    const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    beforeEach(() => {
        sent = [];
        printed = [];
        errors = [];
        respond = () => json(500, { error: { message: "unexpected request", code: "INTERNAL" } });
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            const request: Sent = {
                method: init?.method ?? "GET",
                url: String(input),
                authorization: headers.get("Authorization"),
                body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined
            };
            sent.push(request);
            return respond(request);
        }));
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
            printed.push(args.map(String).join(" "));
        });
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args.map(String).join(" "));
        });
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Error(`exit:${code}`);
        }) as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("create sends the named scopes, roles and expiry with the service key", async () => {
        respond = () => json(201, { key: { ...maskedKey({ roles: ["admin"] }), key: "rk_live_secret" } });

        await apiKeysCommand("create", argv(
            "api-keys", "create", "Blog CI", "--scopes", "data:read:posts,data:write:posts", "--roles", "admin", "--rate-limit", "50"
        ));

        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe("POST");
        expect(sent[0].url).toBe("http://rebase.test/api/admin/api-keys");
        expect(sent[0].authorization).toBe("Bearer svc_test_key");
        expect(sent[0].body).toEqual({
            name: "Blog CI",
            scopes: ["data:read:posts", "data:write:posts"],
            roles: ["admin"],
            rate_limit: 50
        });
        const out = plain(printed);
        expect(out).toContain("rk_live_secret");
        expect(out).toMatch(/Roles:\s+service, admin/);
    });

    it("create --full-access asks which scopes the caller holds and leaves out keys:*", async () => {
        respond = request => request.url.endsWith("/api/auth/scopes")
            ? json(200, { scopes: [], held: ["data:read", "data:write", "users:read", "keys:read", "keys:write", "project:deploy"] })
            : json(201, { key: { ...maskedKey(), key: "rk_live_secret" } });

        await apiKeysCommand("create", argv("api-keys", "create", "Ops", "--full-access"));

        expect(sent.map(r => `${r.method} ${r.url}`)).toEqual([
            "GET http://rebase.test/api/auth/scopes",
            "POST http://rebase.test/api/admin/api-keys"
        ]);
        expect(sent[1].body).toEqual({
            name: "Ops",
            scopes: ["data:read", "data:write", "users:read", "project:deploy"]
        });
    });

    it("create prints the server's refusal by code and exits 1", async () => {
        respond = () => json(403, {
            error: {
                code: "SCOPE_EXCEEDS_CREATOR",
                message: "A key cannot hold more than the account creating it, and you do not hold logs:read.",
                details: { scopes: ["logs:read"] }
            }
        });

        await expect(apiKeysCommand("create", argv("api-keys", "create", "CI", "--scopes", "logs:read")))
            .rejects.toThrow("exit:1");

        const err = plain(errors);
        expect(err).toContain("SCOPE_EXCEEDS_CREATOR (403)");
        expect(err).toContain("you do not hold logs:read");
        expect(plain(printed)).not.toContain("rk_live");
    });

    it("create with a retired option sends nothing", async () => {
        await expect(apiKeysCommand("create", argv("api-keys", "create", "CI", "--admin", "--scopes", "data:read")))
            .rejects.toThrow(/--admin is gone/);
        expect(sent).toEqual([]);
    });

    it("list prints each key's kind, scopes and roles", async () => {
        respond = () => json(200, { keys: [maskedKey(), maskedKey({ id: "key_2", name: "Ops", scopes: ["logs:read"], roles: ["admin"] })] });

        await apiKeysCommand("list", argv("api-keys", "list"));

        expect(sent[0].url).toBe("http://rebase.test/api/admin/api-keys");
        const out = plain(printed);
        expect(out).toMatch(/Blog CI[\s\S]*Kind:\s+service[\s\S]*Scopes:\s+data:read:posts, data:write:posts[\s\S]*Roles:\s+service\n/);
        expect(out).toMatch(/Ops[\s\S]*Scopes:\s+logs:read[\s\S]*Roles:\s+service, admin/);
    });

    it("get reads one key by id", async () => {
        respond = () => json(200, { key: maskedKey({ id: "key 1/x" }) });

        await apiKeysCommand("get", argv("api-keys", "get", "key 1/x"));

        expect(sent[0].url).toBe("http://rebase.test/api/admin/api-keys/key%201%2Fx");
        expect(plain(printed)).toMatch(/Scopes:\s+data:read:posts/);
    });

    it("revoke deletes the key it names", async () => {
        respond = () => json(200, { success: true });

        await apiKeysCommand("revoke", argv("api-keys", "revoke", "key_1"));

        expect(sent.map(r => `${r.method} ${r.url}`)).toEqual(["DELETE http://rebase.test/api/admin/api-keys/key_1"]);
    });

    it("scopes prints the catalogue", async () => {
        respond = () => json(200, {
            scopes: [{ scope: "data:read", label: "Read data", description: "", target: "collection", plane: "data" }],
            held: ["data:read"]
        });

        await apiKeysCommand("scopes", argv("api-keys", "scopes"));

        expect(sent[0].url).toBe("http://rebase.test/api/auth/scopes");
        expect(plain(printed)).toMatch(/✓ data:read\s+Read data/);
    });
});

describe("the help and the flag specs", () => {
    async function helpText(): Promise<string> {
        const printed: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation(message => {
            printed.push(String(message));
        });
        try {
            await apiKeysCommand(undefined, []);
        } finally {
            spy.mockRestore();
        }
        return plain(printed);
    }

    it("advertises only aliases the specs declare", async () => {
        // The other half of the `auth` bug: its help offered `-p` that the spec
        // never declared, so following the help was what triggered the misparse.
        const help = await helpText();
        const advertised = [...help.matchAll(/--[a-z-]+, (-[a-zA-Z])/g)].map(match => match[1]);
        const declared = [...Object.keys(CREATE_KEY_FLAGS), ...Object.keys(REVOKE_KEY_FLAGS), ...Object.keys(GET_KEY_FLAGS)];

        expect(advertised.length).toBeGreaterThan(0);
        for (const alias of advertised) {
            expect(declared).toContain(alias);
        }
    });

    it("lists every long flag the specs declare", async () => {
        // A flag the spec drops is rejected outright rather than ignored, so the
        // spec and the page have to agree.
        const help = await helpText();
        const declared = [...Object.keys(CREATE_KEY_FLAGS), ...Object.keys(REVOKE_KEY_FLAGS), ...Object.keys(GET_KEY_FLAGS)]
            .filter(flag => flag.startsWith("--"));
        for (const flag of declared) {
            expect(help, `the help does not mention ${flag}`).toContain(flag);
        }
    });

    it("neither declares nor teaches a retired option", async () => {
        const help = await helpText();
        for (const flag of Object.keys(RETIRED_CREATE_OPTIONS)) {
            expect(Object.keys(CREATE_KEY_FLAGS)).not.toContain(flag);
            expect(help).not.toMatch(new RegExp(`${flag}(?![\\w-])`));
        }
    });
});
