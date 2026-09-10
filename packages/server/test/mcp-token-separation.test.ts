/**
 * An MCP access token is not a session token, and the separation is enforced.
 *
 * This is the single most important property in the remote-MCP surface, so it
 * gets its own file rather than a clause inside a larger suite.
 *
 * The reason is who holds the credential. Every other token this server mints
 * is held by the user's own browser or by the operator. An MCP access token is
 * handed to *third-party software the user authorized but the operator never
 * vetted* — Claude, an IDE, some agent — and it lives in that software's
 * storage for as long as it is valid. If such a token were also a valid session
 * token, then "connect Claude to your project" would quietly mean "give Claude
 * a full session": `/api/data` on every collection, `/api/admin` if the user is
 * an admin, and the websocket. Nobody consents to that, because nobody is
 * shown it.
 *
 * The mechanism is the `purpose` claim, which `verifyAccessToken` has always
 * refused. These tests pin that refusal to the MCP token specifically, so that
 * a future change to either function has to break an assertion that says why.
 */
import {
    configureJwt,
    generateAccessToken,
    verifyAccessToken,
    generateMcpAccessToken,
    verifyMcpAccessToken,
    MCP_ACCESS_PURPOSE
} from "../src/auth/jwt";

const RESOURCE = "https://talent.sustentalent.com/mcp";
const ISSUER = "https://talent.sustentalent.com";

describe("MCP access tokens are quarantined from session tokens", () => {
    configureJwt({ secret: "test-secret-for-mcp-token-separation-0123456789", accessExpiresIn: "1h" });

    const mint = () => generateMcpAccessToken(
        { uid: "user-1", roles: ["editor"], scope: "mcp:read", clientId: "client-abc", aud: RESOURCE, iss: ISSUER },
        3600
    );

    it("an MCP token is REFUSED by the session verifier", async () => {
        // The whole quarantine, in one assertion. If this ever returns a
        // payload, every MCP client holding a token has a full session.
        expect(await verifyAccessToken(await mint())).toBeNull();
    });

    it("a session token is REFUSED by the MCP verifier", async () => {
        // The converse direction is not a privilege escalation, but it is the
        // spec's rule — "MCP servers MUST only accept tokens that are valid for
        // use with their own resources" — and it stops a browser session from
        // being replayed into the agent surface.
        const session = await generateAccessToken("user-1", ["editor"]);
        expect(await verifyMcpAccessToken(session, RESOURCE)).toBeNull();
    });

    it("round-trips the identity RLS will act on", async () => {
        const payload = await verifyMcpAccessToken(await mint(), RESOURCE);
        expect(payload).toMatchObject({
            purpose: MCP_ACCESS_PURPOSE,
            uid: "user-1",
            roles: ["editor"],
            scope: "mcp:read",
            clientId: "client-abc",
            aud: RESOURCE
        });
    });
});

describe("audience binding (RFC 8707 / MCP authorization)", () => {
    configureJwt({ secret: "test-secret-for-mcp-token-separation-0123456789", accessExpiresIn: "1h" });

    const mintFor = (aud: string) => generateMcpAccessToken(
        { uid: "user-1", roles: [], scope: "mcp:read", clientId: "c", aud, iss: ISSUER },
        3600
    );

    it("accepts a token minted for this exact resource", async () => {
        expect(await verifyMcpAccessToken(await mintFor(RESOURCE), RESOURCE)).not.toBeNull();
    });

    it("refuses a token minted for another project on another host", async () => {
        // The confused-deputy case the specification is most concerned with: a
        // token the user obtained for someone else's MCP server, presented here
        // by a client that got its wires crossed — or by one that did not.
        const other = await mintFor("https://app.medicalmotion.com/mcp");
        expect(await verifyMcpAccessToken(other, RESOURCE)).toBeNull();
    });

    it("refuses a token minted for a different path on THIS host", async () => {
        const other = await mintFor("https://talent.sustentalent.com/mcp-staging");
        expect(await verifyMcpAccessToken(other, RESOURCE)).toBeNull();
    });

    it("refuses a token with no audience at all", async () => {
        expect(await verifyMcpAccessToken(await mintFor(""), RESOURCE)).toBeNull();
    });

    it("refuses a token signed with a different secret", async () => {
        const foreign = await mintFor(RESOURCE);
        configureJwt({ secret: "a-completely-different-secret-0123456789abcd", accessExpiresIn: "1h" });
        expect(await verifyMcpAccessToken(foreign, RESOURCE)).toBeNull();
        configureJwt({ secret: "test-secret-for-mcp-token-separation-0123456789", accessExpiresIn: "1h" });
    });

    it("refuses an expired token", async () => {
        const expired = await generateMcpAccessToken(
            { uid: "user-1", roles: [], scope: "mcp:read", clientId: "c", aud: RESOURCE, iss: ISSUER },
            -1
        );
        expect(await verifyMcpAccessToken(expired, RESOURCE)).toBeNull();
    });

    it("refuses a garbage token without throwing", async () => {
        expect(await verifyMcpAccessToken("not.a.jwt", RESOURCE)).toBeNull();
        expect(await verifyMcpAccessToken("", RESOURCE)).toBeNull();
    });
});
