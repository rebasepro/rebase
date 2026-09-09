/**
 * The surface under hostile and malformed input.
 *
 * `mcp-oauth-flow` proves the protocol works and that the documented refusals
 * refuse. This file assumes an attacker instead of a client: tampered tokens,
 * header spellings that might slip past a naive prefix check, a JSON-RPC batch
 * of a thousand messages, identifiers aimed at the driver, numbers chosen to
 * make arithmetic go wrong.
 *
 * The bar for a test here is that a plausible implementation gets it wrong. So
 * there is nothing asserting that a correct request succeeds — that is the
 * other file's job — and everything asserting that something does not happen.
 */
import { configureJwt, generateAccessToken, generateMcpAccessToken, signPurposeToken } from "../src/auth/jwt";
import {
    buildApp, stubDriver, authorize, redeem, connectedClient, registerClient,
    refreshWith, rpc, pkcePair, RESOURCE, REDIRECT, JWT_SECRET
} from "./helpers/mcp-harness";

configureJwt({ secret: JWT_SECRET, accessExpiresIn: "1h" });

/* ── Bearer token handling ────────────────────────────────────────── */

describe("the bearer gate", () => {
    it("accepts the scheme case-insensitively, as RFC 7235 requires", async () => {
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app);

        for (const scheme of ["Bearer", "bearer", "BEARER", "BeArEr"]) {
            const res = await app.request("/mcp", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `${scheme} ${accessToken}` },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
            });
            expect(res.status).toBe(200);
        }
    });

    it("refuses a token offered under another scheme", async () => {
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app);
        for (const header of [`Basic ${accessToken}`, accessToken, `Token ${accessToken}`]) {
            const res = await app.request("/mcp", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: header },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
            });
            expect(res.status).toBe(401);
        }
    });

    it("refuses a token in the query string", async () => {
        // The MCP specification: access tokens MUST NOT be in the URI. A server
        // that also accepted them there would put credentials in every access
        // log and Referer header on the path.
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app);
        const res = await app.request(`/mcp?access_token=${accessToken}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
        });
        expect(res.status).toBe(401);
    });

    it("refuses a tampered payload", async () => {
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app, { uid: "user-1" });

        const [header, payload, signature] = accessToken.split(".");
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
        decoded.uid = "someone-else";
        decoded.scope = "mcp:read mcp:write";
        const forged = [
            header,
            Buffer.from(JSON.stringify(decoded)).toString("base64url").replace(/=+$/, ""),
            signature
        ].join(".");

        const res = await rpc(app, forged, { jsonrpc: "2.0", id: 1, method: "tools/list" });
        expect(res.status).toBe(401);
    });

    it("refuses an unsigned token claiming alg:none", async () => {
        const { app } = buildApp();
        const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({
            purpose: "mcp-access", uid: "user-1", roles: ["admin"],
            scope: "mcp:read mcp:write", clientId: "x", aud: RESOURCE, iss: "x",
            exp: Math.floor(Date.now() / 1000) + 3600
        })).toString("base64url");

        for (const token of [`${header}.${payload}.`, `${header}.${payload}.sig`]) {
            const res = await rpc(app, token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
            expect(res.status).toBe(401);
        }
    });

    it("refuses a purpose token minted for a different hop", async () => {
        // The authorize-request token is signed with the same secret. Only the
        // `purpose` keeps it from being spent here.
        const { app } = buildApp();
        const other = await signPurposeToken("mcp-authorize-request", {
            uid: "user-1", aud: RESOURCE
        }, 600);
        const res = await rpc(app, other, { jsonrpc: "2.0", id: 1, method: "tools/list" });
        expect(res.status).toBe(401);
    });

    it("refuses an empty bearer value", async () => {
        const { app } = buildApp();
        const res = await app.request("/mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
        });
        expect(res.status).toBe(401);
    });

    it("challenges with the metadata URL on every 401, not just the first", async () => {
        const { app } = buildApp();
        for (const header of [undefined, "Bearer bad", "Bearer "]) {
            const res = await app.request("/mcp", {
                method: "POST",
                headers: header ? { Authorization: header } : {},
                body: "{}"
            });
            expect(res.status).toBe(401);
            expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
        }
    });
});

/* ── JSON-RPC framing ─────────────────────────────────────────────── */

describe("JSON-RPC framing", () => {
    async function withToken() {
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app);
        return { app, accessToken };
    }

    it("answers malformed JSON with a parse error, not a crash", async () => {
        const { app, accessToken } = await withToken();
        const res = await app.request("/mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: "{not json"
        });
        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: number } }).error.code).toBe(-32700);
    });

    it.each([
        ["a bare number", 42],
        ["a bare string", "hello"],
        ["null", null],
        ["a boolean", true]
    ])("refuses %s as a message", async (_label, message) => {
        const { app, accessToken } = await withToken();
        const res = await rpc(app, accessToken, message);
        const body = await res.json() as { error?: { code: number } };
        expect(body.error?.code).toBe(-32600);
    });

    it("refuses a message with no method", async () => {
        const { app, accessToken } = await withToken();
        const body = await (await rpc(app, accessToken, { jsonrpc: "2.0", id: 1 })).json() as {
            error: { code: number };
        };
        expect(body.error.code).toBe(-32600);
    });

    it("refuses a method that is not a string", async () => {
        const { app, accessToken } = await withToken();
        const body = await (await rpc(app, accessToken, { jsonrpc: "2.0", id: 1, method: 42 })).json() as {
            error: { code: number };
        };
        expect(body.error.code).toBe(-32600);
    });

    it("reports an unknown method rather than guessing", async () => {
        const { app, accessToken } = await withToken();
        const body = await (await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "resources/list"
        })).json() as { error: { code: number } };
        expect(body.error.code).toBe(-32601);
    });

    it("stays silent for an unknown NOTIFICATION", async () => {
        // A notification has no id and gets no reply, even when we cannot
        // service it. Answering would violate JSON-RPC and confuse a client
        // that is not waiting for anything.
        const { app, accessToken } = await withToken();
        const res = await rpc(app, accessToken, { jsonrpc: "2.0", method: "notifications/unknown" });
        expect(res.status).toBe(202);
        expect(await res.text()).toBe("");
    });

    it("answers a batch in order and drops the notifications", async () => {
        const { app, accessToken } = await withToken();
        const res = await rpc(app, accessToken, [
            { jsonrpc: "2.0", id: 1, method: "ping" },
            { jsonrpc: "2.0", method: "notifications/initialized" },
            { jsonrpc: "2.0", id: 2, method: "tools/list" }
        ]);
        const body = await res.json() as { id: number }[];
        expect(body.map(m => m.id)).toEqual([1, 2]);
    });

    it("answers a batch of only notifications with 202 and no body", async () => {
        const { app, accessToken } = await withToken();
        const res = await rpc(app, accessToken, [
            { jsonrpc: "2.0", method: "notifications/initialized" },
            { jsonrpc: "2.0", method: "notifications/cancelled" }
        ]);
        expect(res.status).toBe(202);
    });

    it("survives a large batch without falling over", async () => {
        const { app, accessToken } = await withToken();
        const batch = Array.from({ length: 500 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
        const res = await rpc(app, accessToken, batch);
        expect(res.status).toBe(200);
        expect((await res.json() as unknown[]).length).toBe(500);
    });

    it("answers an empty batch with 202 rather than an empty array", async () => {
        const { app, accessToken } = await withToken();
        const res = await rpc(app, accessToken, []);
        expect(res.status).toBe(202);
    });

    it("echoes a string id unchanged", async () => {
        // JSON-RPC ids may be strings; a server that coerced to a number would
        // break every client that uses uuids.
        const { app, accessToken } = await withToken();
        const body = await (await rpc(app, accessToken, {
            jsonrpc: "2.0", id: "abc-123", method: "ping"
        })).json() as { id: string };
        expect(body.id).toBe("abc-123");
    });

    it("echoes back a client's protocol version when we support it", async () => {
        const { app, accessToken } = await withToken();
        const body = await (await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "initialize",
            params: { protocolVersion: "2025-03-26" }
        })).json() as { result: { protocolVersion: string } };
        expect(body.result.protocolVersion).toBe("2025-03-26");
    });

    it("falls back to our latest for a version we do not know", async () => {
        // A client one revision ahead must not fail the handshake outright.
        const { app, accessToken } = await withToken();
        const body = await (await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "initialize",
            params: { protocolVersion: "2099-01-01" }
        })).json() as { result: { protocolVersion: string } };
        expect(body.result.protocolVersion).toBe("2025-06-18");
    });

    it("declares no capability it does not implement", async () => {
        const { app, accessToken } = await withToken();
        const body = await (await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "initialize", params: {}
        })).json() as { result: { capabilities: Record<string, unknown> } };
        expect(Object.keys(body.result.capabilities)).toEqual(["tools"]);
    });
});

/* ── Tool inputs ──────────────────────────────────────────────────── */

describe("tool inputs", () => {
    async function call(name: string, args: Record<string, unknown>, scope = "mcp:read mcp:write") {
        const { driver, calls } = stubDriver();
        const { app } = buildApp({ driver });
        const { accessToken } = await connectedClient(app, { scope });
        const res = await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args }
        });
        const body = await res.json() as {
            result?: { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };
            error?: { message: string };
        };
        return { body, calls };
    }

    it("refuses a collection outside the registry", async () => {
        const { body } = await call("query_collection", { collection: "rebase.oauth_clients" });
        expect(body.result?.isError).toBe(true);
        expect(body.result?.content[0].text).toContain("Unknown collection");
    });

    it.each([
        "candidates; DROP TABLE users",
        "../../etc/passwd",
        "candidates ",
        "CANDIDATES",
        ""
    ])("refuses %j as a collection name", async (name) => {
        const { body } = await call("query_collection", { collection: name });
        expect(body.result?.isError).toBe(true);
    });

    it("refuses an ORDER BY on a field the collection does not declare", async () => {
        // An identifier cannot be bound as a parameter, so whether it is safe
        // depends on what the driver does with it. The registry is the only
        // thing that knows which names are real.
        const { body } = await call("query_collection", { collection: "candidates", orderBy: "id; DROP TABLE x" });
        expect(body.result?.isError).toBe(true);
        expect(body.result?.content[0].text).toContain("cannot be used to sort");
    });

    it("allows ordering by a declared field and by id", async () => {
        for (const field of ["name", "stage", "id"]) {
            const { calls } = await call("query_collection", { collection: "candidates", orderBy: field });
            const args = calls.at(-1)?.args as { orderBy?: [string, string][] };
            expect(args.orderBy).toEqual([[field, "asc"]]);
        }
    });

    it("treats any order value other than desc as ascending", async () => {
        const { calls } = await call("query_collection", { collection: "candidates", orderBy: "name", order: "sideways" });
        const args = calls.at(-1)?.args as { orderBy?: [string, string][] };
        expect(args.orderBy).toEqual([["name", "asc"]]);
    });

    it("refuses a filter on an undeclared field", async () => {
        const { body } = await call("query_collection", {
            collection: "candidates", filter: { salary: ["==", 1] }
        });
        expect(body.result?.isError).toBe(true);
    });

    it.each([
        ["a string", "everything"],
        ["an array", ["a", "b"]],
        ["a number", 5]
    ])("refuses %s as a filter object", async (_label, filter) => {
        const { body } = await call("query_collection", { collection: "candidates", filter });
        expect(body.result?.isError).toBe(true);
    });

    it("refuses a filter condition that is not [operator, value]", async () => {
        for (const condition of [["=="], ["==", 1, 2], "==", 5, null]) {
            const { body } = await call("query_collection", {
                collection: "candidates", filter: { stage: condition }
            });
            expect(body.result?.isError).toBe(true);
        }
    });

    it.each([
        ["a huge limit", 1_000_000, 200],
        ["a negative limit", -5, 25],
        ["zero", 0, 25],
        ["a fractional limit", 10.7, 10],
        ["a string", "abc", 25],
        ["Infinity", Number.MAX_VALUE, 200]
    ])("clamps %s", async (_label, limit, expected) => {
        const { calls } = await call("query_collection", { collection: "candidates", limit });
        expect((calls.at(-1)?.args as { limit: number }).limit).toBe(expected);
    });

    it.each([
        ["a negative offset", -10, 0],
        ["a fractional offset", 5.9, 5],
        ["a string", "ten", 0]
    ])("clamps %s", async (_label, offset, expected) => {
        const { calls } = await call("query_collection", { collection: "candidates", offset });
        expect((calls.at(-1)?.args as { offset: number }).offset).toBe(expected);
    });

    it("says when a result was truncated", async () => {
        // A model given exactly `limit` rows and no signal reports the truncated
        // set as the complete answer.
        const { body } = await call("query_collection", { collection: "candidates", limit: 1 });
        expect(body.result?.structuredContent).toMatchObject({ truncated: true, count: 1 });
    });

    it("gives one message for an absent row and one the caller cannot see", async () => {
        // Distinguishing them would make the tool an existence oracle for rows
        // RLS hides.
        const { driver } = stubDriver();
        (driver as unknown as { fetchOne: () => Promise<undefined> }).fetchOne = async () => undefined;
        const { app } = buildApp({ driver });
        const { accessToken } = await connectedClient(app);

        const res = await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: "get_document", arguments: { collection: "candidates", id: "nope" } }
        });
        const body = await res.json() as { result: { content: { text: string }[] } };
        expect(body.result.content[0].text).toMatch(/No row with id/);
        expect(body.result.content[0].text).not.toMatch(/permission|denied|exists/i);
    });

    it("reports a driver failure as a tool error, not a protocol error", async () => {
        // The distinction is the specification's: a protocol error means the
        // client sent something malformed, this means the model's call did not
        // work — and the model is the one who can try something else.
        const { driver } = stubDriver();
        (driver as unknown as { fetchCollection: () => Promise<never> }).fetchCollection = async () => {
            throw new Error("permission denied for table candidates");
        };
        const { app } = buildApp({ driver });
        const { accessToken } = await connectedClient(app);

        const res = await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: "query_collection", arguments: { collection: "candidates" } }
        });
        const body = await res.json() as { result?: { isError: boolean }; error?: unknown };
        expect(body.error).toBeUndefined();
        expect(body.result?.isError).toBe(true);
    });

    it("does not leak the driver's error text to the model", async () => {
        // An internal message can name tables, columns and constraints the
        // caller has no business knowing about.
        const { driver } = stubDriver();
        (driver as unknown as { fetchCollection: () => Promise<never> }).fetchCollection = async () => {
            throw new Error("relation rebase.oauth_clients does not exist at character 42");
        };
        const { app } = buildApp({ driver });
        const { accessToken } = await connectedClient(app);

        const res = await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: "query_collection", arguments: { collection: "candidates" } }
        });
        const body = await res.json() as { result: { content: { text: string }[] } };
        expect(body.result.content[0].text).not.toContain("oauth_clients");
        expect(body.result.content[0].text).toMatch(/permission rule/i);
    });

    it("reports an unknown tool by name", async () => {
        const { body } = await call("delete_everything", {});
        expect(body.error?.message).toContain("Unknown tool");
    });

    it("refuses tools/call with no name", async () => {
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app);
        const res = await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "tools/call", params: {}
        });
        expect((await res.json() as { error: { code: number } }).error.code).toBe(-32601);
    });

    it("tolerates tools/call with no params at all", async () => {
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app);
        const res = await rpc(app, accessToken, { jsonrpc: "2.0", id: 1, method: "tools/call" });
        expect(res.status).toBe(200);
        expect((await res.json() as { error?: unknown }).error).toBeDefined();
    });

    it("scopes the driver on EVERY tool, not just the first", async () => {
        const { driver, scopedAs } = stubDriver();
        const { app } = buildApp({ driver });
        const { accessToken } = await connectedClient(app, { scope: "mcp:read mcp:write" });

        const calls = [
            { name: "query_collection", arguments: { collection: "candidates" } },
            { name: "get_document", arguments: { collection: "candidates", id: "c1" } },
            { name: "create_document", arguments: { collection: "candidates", values: { name: "X" } } },
            { name: "update_document", arguments: { collection: "candidates", id: "c1", values: { name: "Y" } } },
            { name: "delete_document", arguments: { collection: "candidates", id: "c1" } }
        ];
        for (const params of calls) {
            await rpc(app, accessToken, { jsonrpc: "2.0", id: 1, method: "tools/call", params });
        }

        // Five calls, five scopings, all as the same person. A tool that
        // reached for `ctx.driver` directly would show up as a short count.
        expect(scopedAs).toHaveLength(5);
        expect(new Set(scopedAs.map(s => s.uid))).toEqual(new Set(["user-1"]));
    });

    it("never lists a tool it would then refuse to run", async () => {
        // `tools/list` and `findTool` must agree, or a model is handed a menu
        // with items the kitchen refuses.
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app, { scope: "mcp:read" });
        const listed = (await (await rpc(app, accessToken, {
            jsonrpc: "2.0", id: 1, method: "tools/list"
        })).json() as { result: { tools: { name: string }[] } }).result.tools;

        for (const tool of listed) {
            const res = await rpc(app, accessToken, {
                jsonrpc: "2.0", id: 2, method: "tools/call",
                params: { name: tool.name, arguments: { collection: "candidates", id: "c1" } }
            });
            const body = await res.json() as { error?: { message: string } };
            expect(body.error?.message ?? "").not.toMatch(/scope|Unknown tool/);
        }
    });
});

/* ── The authorize endpoint under bad input ───────────────────────── */

describe("authorize parameter handling", () => {
    async function authorizeWith(params: Record<string, string>) {
        const { app } = buildApp();
        const { body } = await registerClient(app);
        const { challenge } = await pkcePair();
        const query = new URLSearchParams({
            response_type: "code",
            client_id: String(body.client_id),
            redirect_uri: REDIRECT,
            code_challenge: challenge,
            code_challenge_method: "S256",
            resource: RESOURCE,
            ...params
        });
        return app.request(`/api/oauth/authorize?${query}`);
    }

    it("refuses a missing client_id without redirecting", async () => {
        const { app } = buildApp();
        const res = await app.request("/api/oauth/authorize");
        expect(res.status).toBe(400);
        expect(res.headers.get("location")).toBeNull();
    });

    it("refuses an unknown client_id without redirecting", async () => {
        const { app } = buildApp();
        const res = await app.request(`/api/oauth/authorize?${new URLSearchParams({
            client_id: "mcp_nope", redirect_uri: REDIRECT, response_type: "code"
        })}`);
        expect(res.status).toBe(400);
        expect(res.headers.get("location")).toBeNull();
    });

    it.each([
        ["token", "unsupported_response_type"],
        ["code id_token", "unsupported_response_type"],
        ["", "unsupported_response_type"]
    ])("redirects %j as %s", async (responseType, expected) => {
        const res = await authorizeWith({ response_type: responseType });
        expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe(expected);
    });

    it("refuses a missing PKCE challenge", async () => {
        const { app } = buildApp();
        const { body } = await registerClient(app);
        const res = await app.request(`/api/oauth/authorize?${new URLSearchParams({
            response_type: "code", client_id: String(body.client_id),
            redirect_uri: REDIRECT, resource: RESOURCE
        })}`);
        expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    });

    it("refuses plain PKCE, including by omission", async () => {
        // `code_challenge_method` defaults to `plain` in RFC 7636. A server that
        // let the default through would accept the method OAuth 2.1 removes.
        const { app } = buildApp();
        const { body } = await registerClient(app);
        const { challenge } = await pkcePair();
        const res = await app.request(`/api/oauth/authorize?${new URLSearchParams({
            response_type: "code", client_id: String(body.client_id), redirect_uri: REDIRECT,
            code_challenge: challenge, resource: RESOURCE
        })}`);
        expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    });

    it("puts iss on the error redirect too", async () => {
        // A client that validated `iss` only on success would accept a forged
        // failure from anywhere.
        const res = await authorizeWith({ response_type: "token" });
        expect(new URL(res.headers.get("location")!).searchParams.get("iss"))
            .toBe("https://talent.sustentalent.com");
    });

    it("preserves state on the error redirect", async () => {
        const res = await authorizeWith({ response_type: "token", state: "s-123" });
        expect(new URL(res.headers.get("location")!).searchParams.get("state")).toBe("s-123");
    });

    it("refuses a missing resource — the spec makes it mandatory", async () => {
        const { app } = buildApp();
        const { body } = await registerClient(app);
        const { challenge } = await pkcePair();
        const res = await app.request(`/api/oauth/authorize?${new URLSearchParams({
            response_type: "code", client_id: String(body.client_id), redirect_uri: REDIRECT,
            code_challenge: challenge, code_challenge_method: "S256"
        })}`);
        expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    });

    it("drops an unknown scope rather than granting it", async () => {
        const { app } = buildApp();
        const { clientId, code, verifier } = await authorize(app, { scope: "mcp:admin superuser" });
        const { body } = await redeem(app, clientId, code, verifier);
        expect(body.scope).toBe("mcp:read");
    });
});

describe("the decision hop", () => {
    it("refuses an expired authorization request", async () => {
        const { app } = buildApp();
        const stale = await signPurposeToken("mcp-authorize-request", {
            clientId: "x", redirectUri: REDIRECT, codeChallenge: "c",
            codeChallengeMethod: "S256", scope: "mcp:read", resource: RESOURCE
        }, -1);

        const res = await app.request("/api/oauth/authorize/decision", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                request_token: stale,
                session_token: await generateAccessToken("user-1", []),
                decision: "allow"
            })
        });
        expect(res.status).toBe(400);
    });

    it("refuses a request token forged with the wrong purpose", async () => {
        const { app } = buildApp();
        const wrong = await signPurposeToken("some-other-hop", {
            clientId: "x", redirectUri: REDIRECT, codeChallenge: "c",
            codeChallengeMethod: "S256", scope: "mcp:read mcp:write", resource: RESOURCE
        }, 600);

        const res = await app.request("/api/oauth/authorize/decision", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                request_token: wrong,
                session_token: await generateAccessToken("user-1", []),
                decision: "allow"
            })
        });
        expect(res.status).toBe(400);
    });

    it("refuses an MCP access token as proof of who is consenting", async () => {
        // Otherwise an application already connected could authorize itself for
        // more scope without the user present.
        const { app } = buildApp();
        const { clientId } = await connectedClient(app);
        const mcpToken = await generateMcpAccessToken({
            uid: "user-1", roles: [], scope: "mcp:read", clientId, aud: RESOURCE, iss: "x"
        }, 3600);

        const { requestToken } = await authorize(app, { clientId });
        const res = await app.request("/api/oauth/authorize/decision", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                request_token: requestToken, session_token: mcpToken, decision: "allow"
            })
        });
        expect(new URL(res.headers.get("location")!).searchParams.get("code")).toBeNull();
    });

    it("treats anything other than `allow` as a denial", async () => {
        const { app } = buildApp();
        const { requestToken } = await authorize(app);
        for (const decision of ["deny", "", "ALLOW", "yes"]) {
            const res = await app.request("/api/oauth/authorize/decision", {
                method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    request_token: requestToken,
                    session_token: await generateAccessToken("user-1", []),
                    decision
                })
            });
            if (decision === "allow") continue;
            expect(new URL(res.headers.get("location")!).searchParams.get("code")).toBeNull();
        }
    });
});

/* ── Registration ─────────────────────────────────────────────────── */

describe("dynamic client registration", () => {
    it("refuses a non-JSON body", async () => {
        const { app } = buildApp();
        const res = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "not json"
        });
        expect(res.status).toBe(400);
    });

    it("refuses no redirect_uris", async () => {
        const { app } = buildApp();
        for (const body of [{}, { redirect_uris: [] }, { redirect_uris: "https://x/cb" }]) {
            const res = await app.request("/api/oauth/register", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
            });
            expect(res.status).toBe(400);
        }
    });

    it.each([
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "http://evil.example.com/cb",
        "https://x.example/cb#frag",
        "not-a-uri",
        "file:///etc/passwd"
    ])("refuses %j as a redirect URI", async (uri) => {
        const { app } = buildApp();
        const res = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_name: "x", redirect_uris: [uri] })
        });
        expect(res.status).toBe(400);
    });

    it("accepts loopback http and a private-use scheme", async () => {
        // RFC 8252: both are how a native client receives a redirect.
        for (const uri of ["http://127.0.0.1:1234/cb", "com.example.app:/callback"]) {
            const { app } = buildApp();
            const res = await app.request("/api/oauth/register", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_name: "x", redirect_uris: [uri] })
            });
            expect(res.status).toBe(201);
        }
    });

    it("refuses a client asking for a grant we do not issue", async () => {
        const { app } = buildApp();
        const res = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_name: "x", redirect_uris: [REDIRECT], grant_types: ["client_credentials"]
            })
        });
        expect(res.status).toBe(400);
    });

    it("returns the secret exactly once, and never again", async () => {
        const { app, store } = buildApp();
        const { body } = await registerClient(app, { token_endpoint_auth_method: "client_secret_post" });
        expect(body.client_secret).toBeTruthy();

        // Nothing stores it in the clear, so it cannot be re-read.
        const stored = await store.getClient(String(body.client_id));
        expect(stored?.clientSecretHash).not.toBe(body.client_secret);
        expect(stored?.clientSecretHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("gives a public client no secret at all", async () => {
        const { app } = buildApp();
        const { body } = await registerClient(app, { token_endpoint_auth_method: "none" });
        expect(body.client_secret).toBeUndefined();
    });

    it("can be switched off, and says so as 403 rather than 404", async () => {
        const { app } = buildApp({ allowDynamicRegistration: false });
        const res = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_name: "x", redirect_uris: [REDIRECT] })
        });
        expect(res.status).toBe(403);
    });

    it("truncates an absurd client name rather than storing it", async () => {
        const { app, store } = buildApp();
        const { body } = await registerClient(app, { client_name: "A".repeat(10_000) });
        const stored = await store.getClient(String(body.client_id));
        expect(stored!.clientName.length).toBeLessThanOrEqual(200);
    });

    it("gives an unnamed client a placeholder rather than an empty screen", async () => {
        const { app } = buildApp();
        const { body } = await registerClient(app, { client_name: "   " });
        const { html } = await authorize(app, { clientId: String(body.client_id) });
        expect(html).toContain("Unnamed MCP client");
    });
});

/* ── Regressions found by reading, not by failing ─────────────────── */

describe("a refresh can narrow the grant but never widen it", () => {
    it("refuses a scope that is not a subset of what was granted", async () => {
        // The bug: the intersection line ended `|| record.scope`, so asking for
        // a scope you do not hold produced an EMPTY intersection and fell back
        // to the full held scope. A client holding `mcp:write` and asking for
        // `mcp:read` was handed `mcp:write` — a refresh that widens.
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app, { scope: "mcp:read" });

        const res = await refreshWith(app, clientId, refreshToken, { scope: "mcp:write" });
        expect(res.status).toBe(400);
        expect((await res.json() as { error: string }).error).toBe("invalid_scope");
    });

    it("narrows to the intersection when one is asked for", async () => {
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app, { scope: "mcp:read mcp:write" });

        const res = await refreshWith(app, clientId, refreshToken, { scope: "mcp:read" });
        expect(res.status).toBe(200);
        expect((await res.json() as { scope: string }).scope).toBe("mcp:read");
    });

    it("keeps the full grant when no scope is asked for", async () => {
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app, { scope: "mcp:read mcp:write" });

        const res = await refreshWith(app, clientId, refreshToken);
        expect((await res.json() as { scope: string }).scope).toBe("mcp:read mcp:write");
    });

    it("a narrowed token really has lost the tool", async () => {
        // The scope string in the response is not the assertion worth making —
        // what the token can do is.
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app, { scope: "mcp:read mcp:write" });

        const narrowed = await refreshWith(app, clientId, refreshToken, { scope: "mcp:read" });
        const token = String((await narrowed.json() as Record<string, unknown>).access_token);

        const listed = (await (await rpc(app, token, {
            jsonrpc: "2.0", id: 1, method: "tools/list"
        })).json() as { result: { tools: { name: string }[] } }).result.tools;
        expect(listed.map(t => t.name)).not.toContain("create_document");
    });
});

describe("RFC 7009 revoke does not let a stranger destroy a grant", () => {
    it("a token presented under someone else's client id is inert", async () => {
        // The bug: `/revoke` called `consumeRefreshToken` and checked ownership
        // afterwards. That marks the token spent before establishing it belongs
        // to the caller — and a spent token makes the legitimate holder's next
        // refresh look like a replay, which kills the whole family. So anyone
        // who merely learned a token string could destroy the grant.
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app);
        const { body: stranger } = await registerClient(app, { client_name: "stranger" });

        const res = await app.request("/api/oauth/revoke", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: String(stranger.client_id), token: refreshToken })
        });
        expect(res.status).toBe(200);   // RFC 7009: never an error

        // And the owner's token is untouched — not spent, not revoked.
        const refreshed = await refreshWith(app, clientId, refreshToken);
        expect(refreshed.status).toBe(200);
    });

    it("the owner can still revoke it", async () => {
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app);

        await app.request("/api/oauth/revoke", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: clientId, token: refreshToken })
        });
        expect((await refreshWith(app, clientId, refreshToken)).status).toBe(400);
    });

    it("revoking one token kills its whole family", async () => {
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app);
        const rotated = await refreshWith(app, clientId, refreshToken);
        const second = String((await rotated.json() as Record<string, unknown>).refresh_token);

        await app.request("/api/oauth/revoke", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: clientId, token: second })
        });
        expect((await refreshWith(app, clientId, second)).status).toBe(400);
    });
});

describe("a notification gets no reply, whatever the method", () => {
    // Three cases below did not check for a missing id and would have answered
    // with `id: null` — a message the client is not waiting for and cannot
    // match to anything. The check now happens once, on whatever the switch
    // produced, so a method added later cannot forget it.
    it.each([
        "initialize",
        "tools/list",
        "ping",
        "tools/call",
        "resources/list"
    ])("stays silent for a notification-shaped %s", async (method) => {
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app);

        const res = await rpc(app, accessToken, { jsonrpc: "2.0", method });
        expect(res.status).toBe(202);
        expect(await res.text()).toBe("");
    });

    it("still answers the same methods when they carry an id", async () => {
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app);

        for (const method of ["initialize", "tools/list", "ping"]) {
            const res = await rpc(app, accessToken, { jsonrpc: "2.0", id: 7, method });
            expect(res.status).toBe(200);
            expect((await res.json() as { id: number }).id).toBe(7);
        }
    });

    it("drops notifications out of a mixed batch without shifting the rest", async () => {
        const { app } = buildApp();
        const { accessToken } = await connectedClient(app);

        const res = await rpc(app, accessToken, [
            { jsonrpc: "2.0", method: "tools/list" },          // notification
            { jsonrpc: "2.0", id: "a", method: "ping" },
            { jsonrpc: "2.0", method: "initialize" },          // notification
            { jsonrpc: "2.0", id: "b", method: "ping" }
        ]);
        const body = await res.json() as { id: string }[];
        expect(body.map(m => m.id)).toEqual(["a", "b"]);
    });
});
