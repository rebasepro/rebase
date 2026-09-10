/**
 * Disconnecting an application, and who is allowed to do it.
 *
 * Revocation is the promise the consent screen makes — "you can disconnect it
 * later, which stops it renewing its access" — so these tests are the thing
 * that keeps that sentence true. The screen briefly carried it while nothing
 * could revoke anything; the line came out, and went back in with this suite.
 *
 * The two properties that matter are not "revoke works":
 *
 *  - **A grant is not permission to manage grants.** An application the user
 *    connected must not be able to enumerate, or revoke, the others. That is an
 *    escalation from "read my candidates" to "control my account's
 *    integrations".
 *  - **Revocation is scoped to the person doing it.** One user disconnecting
 *    another's application would be a denial-of-service with a one-line request.
 */
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import {
    buildApp, authorize, redeem, refreshWith, connectedClient,
    registerClient, PUBLIC_URL, REDIRECT, JWT_SECRET
} from "./helpers/mcp-harness";

configureJwt({ secret: JWT_SECRET, accessExpiresIn: "1h" });

const sessionFor = (uid: string, roles: string[] = []) => generateAccessToken(uid, roles);

describe("connected applications", () => {
    it("lists what the user has connected, with a live token count", async () => {
        const { app } = buildApp();
        const { clientId } = await connectedClient(app);

        const res = await app.request("/api/oauth/grants", {
            headers: { Authorization: `Bearer ${await sessionFor("user-1")}` }
        });
        const { grants } = await res.json() as {
            grants: { clientId: string; clientName: string; scope: string; activeTokens: number }[];
        };

        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({
            clientId, clientName: "Claude", scope: "mcp:read", activeTokens: 1
        });
    });

    it("shows one user nothing about another's grants", async () => {
        const { app } = buildApp();
        await connectedClient(app, { uid: "user-1" });

        const res = await app.request("/api/oauth/grants", {
            headers: { Authorization: `Bearer ${await sessionFor("user-2")}` }
        });
        expect((await res.json() as { grants: unknown[] }).grants).toEqual([]);
    });

    it("refuses an MCP token — a grant is not permission to manage grants", async () => {
        const { app } = buildApp();
        const { clientId, accessToken } = await connectedClient(app);

        const list = await app.request("/api/oauth/grants", {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        expect(list.status).toBe(401);

        const kill = await app.request(`/api/oauth/grants/${clientId}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` }
        });
        expect(kill.status).toBe(401);
    });

    it("refuses an unauthenticated caller", async () => {
        const { app } = buildApp();
        expect((await app.request("/api/oauth/grants")).status).toBe(401);
        expect((await app.request("/api/oauth/grants/x", { method: "DELETE" })).status).toBe(401);
    });

    it("refuses a garbage bearer token", async () => {
        const { app } = buildApp();
        const res = await app.request("/api/oauth/grants", { headers: { Authorization: "Bearer nonsense" } });
        expect(res.status).toBe(401);
    });
});

describe("disconnecting", () => {
    it("stops the application renewing its access", async () => {
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app);
        const session = await sessionFor("user-1");

        const res = await app.request(`/api/oauth/grants/${clientId}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${session}` }
        });
        expect(res.status).toBe(200);
        expect((await res.json() as { revoked: boolean }).revoked).toBe(true);

        expect((await refreshWith(app, clientId, refreshToken)).status).toBe(400);

        const list = await app.request("/api/oauth/grants", { headers: { Authorization: `Bearer ${session}` } });
        expect((await list.json() as { grants: unknown[] }).grants).toEqual([]);
    });

    it("says plainly that an issued access token keeps working", async () => {
        // The claim the endpoint must not overstate. Access tokens are
        // self-contained JWTs verified without a database round trip — that is
        // what makes `/mcp` cheap — so revocation cannot reach one already
        // issued. Saying so is the difference between a limitation and a lie.
        const { app } = buildApp();
        const { clientId } = await connectedClient(app);
        const res = await app.request(`/api/oauth/grants/${clientId}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${await sessionFor("user-1")}` }
        });
        const body = await res.json() as { note: string };
        expect(body.note).toMatch(/access token already issued keeps working/i);
        expect(body.note).toMatch(/one hour/i);
    });

    it("revokes every token in the grant, not just the newest", async () => {
        // A client that refreshed a few times has a chain behind it. Revoking
        // only the latest would leave earlier, still-unexpired members usable.
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app);

        const rotated = await refreshWith(app, clientId, refreshToken);
        const second = String((await rotated.json() as Record<string, unknown>).refresh_token);

        await app.request(`/api/oauth/grants/${clientId}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${await sessionFor("user-1")}` }
        });

        expect((await refreshWith(app, clientId, second)).status).toBe(400);
    });

    it("cannot disconnect another user's application", async () => {
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app, { uid: "user-1" });

        const res = await app.request(`/api/oauth/grants/${clientId}`, {
            method: "DELETE",
            // Deliberately an admin: being an admin of the application is not
            // being the owner of someone else's integration.
            headers: { Authorization: `Bearer ${await sessionFor("user-2", ["admin"])}` }
        });
        expect(res.status).toBe(404);

        expect((await refreshWith(app, clientId, refreshToken)).status).toBe(200);
    });

    it("answers 404 for an application that was never connected", async () => {
        const { app } = buildApp();
        const res = await app.request("/api/oauth/grants/mcp_nothing", {
            method: "DELETE", headers: { Authorization: `Bearer ${await sessionFor("user-1")}` }
        });
        expect(res.status).toBe(404);
    });

    it("is idempotent — a second disconnect is a 404, not a 500", async () => {
        const { app } = buildApp();
        const { clientId } = await connectedClient(app);
        const session = await sessionFor("user-1");
        const url = `/api/oauth/grants/${clientId}`;

        expect((await app.request(url, { method: "DELETE", headers: { Authorization: `Bearer ${session}` } })).status).toBe(200);
        expect((await app.request(url, { method: "DELETE", headers: { Authorization: `Bearer ${session}` } })).status).toBe(404);
    });

    it("lets the user reconnect afterwards", async () => {
        // Revocation forgets the consent, so the next authorization is a fresh
        // decision rather than a permanent block.
        const { app } = buildApp();
        const { clientId } = await connectedClient(app);
        await app.request(`/api/oauth/grants/${clientId}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${await sessionFor("user-1")}` }
        });

        const again = await authorize(app, { clientId });
        expect(again.code).not.toBe("");
        const { res } = await redeem(app, clientId, again.code, again.verifier);
        expect(res.status).toBe(200);
    });
});

describe("RFC 7009 token revocation", () => {
    it("revokes a client's own refresh token", async () => {
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app);

        const res = await app.request("/api/oauth/revoke", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: clientId, token: refreshToken })
        });
        expect(res.status).toBe(200);
        expect((await refreshWith(app, clientId, refreshToken)).status).toBe(400);
    });

    it("answers 200 for a token that never existed — not an existence oracle", async () => {
        const { app } = buildApp();
        const res = await app.request("/api/oauth/revoke", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: "nobody", token: "made-up" })
        });
        expect(res.status).toBe(200);
    });

    it("answers 200 for an empty body", async () => {
        const { app } = buildApp();
        const res = await app.request("/api/oauth/revoke", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({})
        });
        expect(res.status).toBe(200);
    });

    it("does not let one client revoke another's grant", async () => {
        const { app } = buildApp();
        const { clientId, refreshToken } = await connectedClient(app);
        const { body: thief } = await registerClient(app, { client_name: "thief" });

        await app.request("/api/oauth/revoke", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: String(thief.client_id), token: refreshToken })
        });

        // The owner's grant survives — the family was not revoked.
        const list = await app.request("/api/oauth/grants", {
            headers: { Authorization: `Bearer ${await sessionFor("user-1")}` }
        });
        const { grants } = await list.json() as { grants: { clientId: string }[] };
        expect(grants.map(g => g.clientId)).toEqual([clientId]);
    });

    it("is advertised in the authorization-server metadata", async () => {
        const { app } = buildApp();
        const doc = await (await app.request("/.well-known/oauth-authorization-server")).json() as {
            revocation_endpoint: string;
            revocation_endpoint_auth_methods_supported: string[];
        };
        expect(doc.revocation_endpoint).toBe(`${PUBLIC_URL}/api/oauth/revoke`);
        expect(doc.revocation_endpoint_auth_methods_supported).toContain("none");
    });

    it("requires the secret from a confidential client", async () => {
        const { app } = buildApp();
        const { body: confidential } = await registerClient(app, {
            client_name: "server-side", token_endpoint_auth_method: "client_secret_post"
        });
        const clientId = String(confidential.client_id);

        const { code, verifier } = await authorize(app, { clientId });
        const { body } = await redeem(app, clientId, code, verifier, {
            client_secret: String(confidential.client_secret)
        });

        const noSecret = await app.request("/api/oauth/revoke", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: clientId, token: String(body.refresh_token) })
        });
        expect(noSecret.status).toBe(401);

        // And the token still works, because nothing was revoked.
        expect((await refreshWith(app, clientId, String(body.refresh_token), {
            client_secret: String(confidential.client_secret)
        })).status).toBe(200);
    });
});

describe("the consent screen's promise", () => {
    it("names disconnection, now that disconnection exists", async () => {
        const { app } = buildApp();
        const { html } = await authorize(app);
        expect(html).toMatch(/disconnect it later/i);
    });

    it("does not claim more than revocation does", async () => {
        // It must not say the application loses access immediately: an issued
        // access token outlives the disconnect by up to its lifetime.
        const { app } = buildApp();
        const { html } = await authorize(app);
        expect(html).not.toMatch(/revoke .*immediately|instantly/i);
    });

    it("escapes a hostile client name", async () => {
        // Anyone may register, so the name on the consent screen is
        // attacker-controlled text rendered into HTML.
        const { app } = buildApp();
        const { body } = await registerClient(app, {
            client_name: `<img src=x onerror="alert(1)">`
        });
        const { html } = await authorize(app, { clientId: String(body.client_id) });

        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&lt;img src=x");
        expect(html).not.toContain("onerror=\"alert(1)\"");
    });

    it("cannot break out of the title attribute either", async () => {
        const { app } = buildApp();
        const { body } = await registerClient(app, { client_name: `" onload="alert(1)` });
        const { html } = await authorize(app, { clientId: String(body.client_id) });
        expect(html).not.toContain(`" onload="alert(1)`);
        expect(html).toContain("&quot; onload=&quot;");
    });

    it("names the resource so the user can see which server this is", async () => {
        const { app } = buildApp();
        const { html } = await authorize(app);
        expect(html).toContain("https://talent.sustentalent.com/mcp");
    });

    it("posts credentials only to the existing login endpoint", async () => {
        // The consent page must never send a password to the OAuth surface.
        const { app } = buildApp();
        const { html } = await authorize(app);
        const fetchTargets = [...html.matchAll(/fetch\((\"[^\"]+\")/g)].map(m => JSON.parse(m[1]));
        expect(fetchTargets).toEqual(["/api/auth/login"]);
    });

    it("tells search engines not to index it", async () => {
        const { app } = buildApp();
        const { html } = await authorize(app);
        expect(html).toContain('name="robots" content="noindex, nofollow"');
    });

    it("lists the granted scopes in words, not identifiers", async () => {
        const { app } = buildApp();
        const { html } = await authorize(app, { scope: "mcp:read mcp:write" });
        expect(html).toContain("Read data you already have access to");
        expect(html).toContain("Create, change and delete data you already have access to");
    });

    it("does not offer write in the list when only read was asked for", async () => {
        const { app } = buildApp();
        const { html } = await authorize(app, { scope: "mcp:read" });
        expect(html).not.toContain("Create, change and delete");
    });

    it("carries the redirect target nowhere the user can see or edit", async () => {
        // The redirect URI is validated server-side against the registration and
        // travels inside the signed request token. It must not appear as an
        // editable field.
        const { app } = buildApp();
        const { html } = await authorize(app);
        expect(html).not.toContain(REDIRECT);
    });
});
