/**
 * Persistence for the OAuth 2.1 authorization server that fronts `/mcp`.
 *
 * Four tables, all in the `rebase` schema and all revoked from `rebase_user`:
 * they hold client secrets, live authorization codes and refresh tokens, and a
 * policy-scoped role must never be able to read them. `revokeInternalTableSql`
 * is the same guard every other internal table uses — see
 * `common/util/internal-tables.ts`.
 *
 * Nothing here stores a credential in the clear. Authorization codes and
 * refresh tokens are looked up by SHA-256 of the presented value, so a database
 * disclosure yields hashes rather than usable tokens, and the lookup stays a
 * primary-key hit rather than a scan. Client secrets are hashed the same way;
 * they are 256 bits of `randomHex`, not passwords, so a slow KDF would buy
 * nothing a dictionary attack could exploit.
 *
 * The store deliberately knows nothing about HTTP. It is the only place that
 * writes these tables, which is what lets the refresh-token rotation invariant
 * — one use, and a second use kills the family — be stated once.
 */
import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";
import { revokeInternalTableSql } from "@rebasepro/common";
import { logger } from "../utils/logger.js";
import { createDdlBootstrapper } from "../boot/ddl-bootstrap.js";
import { sha256Hex } from "../utils/portable-crypto.js";

const CLIENTS = "rebase.oauth_clients";
const CODES = "rebase.oauth_authorization_codes";
const REFRESH = "rebase.oauth_refresh_tokens";
const CONSENTS = "rebase.oauth_consents";

/** Every table this store owns, for the revoke sweep and for tests. */
export const OAUTH_TABLES = [CLIENTS, CODES, REFRESH, CONSENTS] as const;

/**
 * How long an authorization code lives.
 *
 * OAuth 2.1 says a code SHOULD be short-lived and names one minute as the
 * benchmark. The code never leaves the user-agent's redirect hop, so there is
 * no legitimate flow that needs longer, and a code sitting in browser history
 * or a proxy log stops being useful within a minute of being written there.
 */
export const AUTHORIZATION_CODE_TTL_MS = 60_000;

export interface OAuthClient {
    clientId: string;
    clientSecretHash: string | null;
    clientName: string;
    redirectUris: string[];
    grantTypes: string[];
    scope: string;
    tokenEndpointAuthMethod: string;
}

export interface AuthorizationCodeRecord {
    clientId: string;
    uid: string;
    roles: string[];
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string;
    resource: string;
}

export interface RefreshTokenRecord {
    clientId: string;
    uid: string;
    /**
     * The roles the grant was made with.
     *
     * Carried here because a refresh has no session to re-read them from, and
     * an access token minted with an empty `roles` is not a smaller grant — it
     * is a DIFFERENT identity to the database. Any policy written as "a row this
     * user's role may see" evaluates against an empty list and returns nothing,
     * so dropping them turns the first token refresh into an integration that
     * silently stops seeing data.
     *
     * The consequence of storing them is that a role change does not reach an
     * existing grant until the refresh token expires or the user revokes the
     * client. That is stated in the docs, and it is the trade this design makes
     * knowingly: the alternative is a user lookup on every refresh, which puts
     * the auth adapter on a path that currently has no dependency on it.
     */
    roles: string[];
    scope: string;
    resource: string;
    family: string;
}

export interface OAuthStore {
    ensureTables(): Promise<void>;

    registerClient(client: OAuthClient): Promise<void>;
    getClient(clientId: string): Promise<OAuthClient | null>;
    countClients(): Promise<number>;

    saveAuthorizationCode(code: string, record: AuthorizationCodeRecord, expiresAt: Date): Promise<void>;
    /**
     * Exchange a code, once. Returns null if it is unknown, expired, or has
     * already been redeemed.
     */
    consumeAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | null>;

    saveRefreshToken(token: string, record: RefreshTokenRecord, expiresAt: Date): Promise<void>;
    /**
     * Redeem a refresh token, rotating it. Returns null when the token is
     * unknown, expired or revoked — and, on a REPLAY, revokes every token in
     * the same family before returning null.
     */
    consumeRefreshToken(token: string): Promise<RefreshTokenRecord | null>;
    revokeFamily(family: string): Promise<void>;
    /**
     * Revoke the family a token belongs to, for RFC 7009 — without spending it.
     *
     * Deliberately not `consumeRefreshToken` followed by a check. That order
     * marks the token spent BEFORE establishing it belongs to the caller, and a
     * spent token makes the legitimate holder's next refresh look like a replay,
     * which kills the family. So anyone who merely learned a token string could
     * destroy the grant by presenting it here under any client id of their own.
     * This reads first and writes only on a match.
     *
     * @returns whether anything was revoked.
     */
    revokeTokenForClient(token: string, clientId: string): Promise<boolean>;

    /**
     * Remember that this person approved this client for this scope.
     *
     * Written, listed and revoked — but never *read* to skip the consent
     * screen, and that omission is deliberate. Skipping requires knowing who
     * the user is at `GET /authorize`, before they have signed in, and the only
     * thing this server has there is the refresh cookie. Reading it means
     * consuming and rotating a refresh token on a GET, which would disturb the
     * user's ordinary application session to save them one click — and would
     * put an auto-approval path on an endpoint any site can navigate a browser
     * to. The screen is shown every time. If that is ever revisited, the guard
     * is that only a client with a PRIOR interactive consent may be
     * auto-approved, or the endpoint mints codes for an attacker's client.
     */
    recordConsent(uid: string, clientId: string, scope: string): Promise<void>;

    /** Every application this person has connected, for a "connected apps" list. */
    listGrants(uid: string): Promise<GrantSummary[]>;
    /**
     * Disconnect one application, completely.
     *
     * Revokes every refresh token this person holds for that client and forgets
     * the consent, so the next authorization asks again. Returns false when
     * there was nothing to revoke, which lets the route answer 404 rather than
     * reporting success for a client the user never connected.
     *
     * Access tokens already issued are NOT invalidated — they are self-contained
     * JWTs with no per-request database lookup, which is what makes `/mcp` cheap.
     * The window is therefore one access-token lifetime (an hour), and the
     * route's response says so rather than implying an instant cut-off.
     */
    revokeGrant(uid: string, clientId: string): Promise<boolean>;
}

/** One row of the "applications you have connected" list. */
export interface GrantSummary {
    clientId: string;
    clientName: string;
    scope: string;
    grantedAt: string;
    /** Live refresh tokens for this grant. Zero means it has lapsed on its own. */
    activeTokens: number;
}

/**
 * A store backed by the driver's SQL escape hatch.
 *
 * Returns null when the driver cannot run SQL — Mongo, for one. The OAuth
 * surface is then not mounted at all rather than half-mounted: an authorization
 * server that cannot persist a code is not a degraded authorization server, it
 * is one that hands out credentials it cannot check.
 */
export function createOAuthStore(driver: DataDriver): OAuthStore | null {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) return null;

    const exec = (sql: string, params?: unknown[]) => admin.executeSql(sql, params ? { params } : undefined);
    const ddl = createDdlBootstrapper(sql => exec(sql), "oauth-store");

    return {
        async ensureTables() {
            await ddl.ensureObject(CLIENTS, `
                CREATE TABLE IF NOT EXISTS ${CLIENTS} (
                    client_id                  text PRIMARY KEY,
                    client_secret_hash         text,
                    client_name                text NOT NULL,
                    redirect_uris              text[] NOT NULL,
                    grant_types                text[] NOT NULL,
                    scope                      text NOT NULL,
                    token_endpoint_auth_method text NOT NULL,
                    created_at                 timestamptz NOT NULL DEFAULT now()
                )
            `);

            await ddl.ensureObject(CODES, `
                CREATE TABLE IF NOT EXISTS ${CODES} (
                    code_hash             text PRIMARY KEY,
                    client_id             text NOT NULL,
                    uid                   text NOT NULL,
                    roles                 text[] NOT NULL DEFAULT '{}',
                    redirect_uri          text NOT NULL,
                    code_challenge        text NOT NULL,
                    code_challenge_method text NOT NULL,
                    scope                 text NOT NULL,
                    resource              text NOT NULL,
                    expires_at            timestamptz NOT NULL,
                    consumed_at           timestamptz
                )
            `);

            await ddl.ensureObject(REFRESH, `
                CREATE TABLE IF NOT EXISTS ${REFRESH} (
                    token_hash  text PRIMARY KEY,
                    family      text NOT NULL,
                    client_id   text NOT NULL,
                    uid         text NOT NULL,
                    roles       text[] NOT NULL DEFAULT '{}',
                    scope       text NOT NULL,
                    resource    text NOT NULL,
                    issued_at   timestamptz NOT NULL DEFAULT now(),
                    expires_at  timestamptz NOT NULL,
                    consumed_at timestamptz,
                    revoked_at  timestamptz
                )
            `);

            // The family index carries the replay response: a reused token has
            // to revoke every sibling, and that is a write across the family
            // on the hot path of an ordinary refresh going wrong.
            await ddl.ensureObject(`${REFRESH} family index`, `
                CREATE INDEX IF NOT EXISTS oauth_refresh_family_idx ON ${REFRESH} (family)
            `);

            await ddl.ensureObject(CONSENTS, `
                CREATE TABLE IF NOT EXISTS ${CONSENTS} (
                    uid        text NOT NULL,
                    client_id  text NOT NULL,
                    scope      text NOT NULL,
                    granted_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (uid, client_id)
                )
            `);

            for (const table of OAUTH_TABLES) {
                const [schema, name] = table.split(".");
                await ddl.step(`revoke ${table}`, () => exec(revokeInternalTableSql(schema, name)));
            }

            // Expired codes are worthless the minute they lapse and there is no
            // audit value in keeping them: they carry a redirect URI and a PKCE
            // challenge for a session that never completed. Refresh rows are
            // kept until expiry so a replay still finds its family.
            await ddl.step("sweep expired codes", () =>
                exec(`DELETE FROM ${CODES} WHERE expires_at < now() - interval '1 hour'`));
            await ddl.step("sweep expired refresh tokens", () =>
                exec(`DELETE FROM ${REFRESH} WHERE expires_at < now() - interval '30 days'`));

            // Ask the database whether the work actually happened.
            //
            // `createDdlBootstrapper` catches and LOGS a failed statement rather
            // than throwing — the right trade for the cron log table, where a
            // failure should not stop a server from serving. It is the wrong
            // trade here: an authorization server whose tables do not exist
            // still mounts, still answers `/register`, and issues credentials it
            // has nowhere to check against. Every call then 500s, and the only
            // evidence is one line in a boot log nobody re-reads.
            //
            // So this is the difference between "we ran some DDL" and "the
            // tables are there". The caller declines to mount on a throw.
            const missing: string[] = [];
            for (const table of OAUTH_TABLES) {
                const rows = await exec(`SELECT to_regclass($1) AS present`, [table]);
                if (rows[0]?.present == null) missing.push(table);
            }
            if (missing.length > 0) {
                throw new Error(
                    `The OAuth tables were not created: ${missing.join(", ")}. `
                    + "The MCP surface cannot be served without them — check the boot log above for the "
                    + "statement that failed, which is usually a permissions problem on the `rebase` schema."
                );
            }
        },

        async registerClient(client) {
            await exec(
                `INSERT INTO ${CLIENTS}
                    (client_id, client_secret_hash, client_name, redirect_uris,
                     grant_types, scope, token_endpoint_auth_method)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    client.clientId,
                    client.clientSecretHash,
                    client.clientName,
                    client.redirectUris,
                    client.grantTypes,
                    client.scope,
                    client.tokenEndpointAuthMethod
                ]
            );
        },

        async getClient(clientId) {
            const rows = await exec(`SELECT * FROM ${CLIENTS} WHERE client_id = $1`, [clientId]);
            const row = rows[0];
            if (!row) return null;
            return {
                clientId: String(row.client_id),
                clientSecretHash: row.client_secret_hash == null ? null : String(row.client_secret_hash),
                clientName: String(row.client_name),
                redirectUris: toStringArray(row.redirect_uris),
                grantTypes: toStringArray(row.grant_types),
                scope: String(row.scope),
                tokenEndpointAuthMethod: String(row.token_endpoint_auth_method)
            };
        },

        async countClients() {
            const rows = await exec(`SELECT count(*)::int AS n FROM ${CLIENTS}`);
            return Number(rows[0]?.n ?? 0);
        },

        async saveAuthorizationCode(code, record, expiresAt) {
            await exec(
                `INSERT INTO ${CODES}
                    (code_hash, client_id, uid, roles, redirect_uri,
                     code_challenge, code_challenge_method, scope, resource, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    await sha256Hex(code),
                    record.clientId,
                    record.uid,
                    record.roles,
                    record.redirectUri,
                    record.codeChallenge,
                    record.codeChallengeMethod,
                    record.scope,
                    record.resource,
                    expiresAt.toISOString()
                ]
            );
        },

        async consumeAuthorizationCode(code) {
            // One statement, so the read and the mark cannot interleave with a
            // second redemption of the same code. `consumed_at IS NULL` in the
            // WHERE is the whole single-use guarantee: two racing exchanges both
            // reach the UPDATE, exactly one matches a row, and the loser gets no
            // rows back rather than a second copy of the grant.
            const rows = await exec(
                `UPDATE ${CODES}
                    SET consumed_at = now()
                  WHERE code_hash = $1
                    AND consumed_at IS NULL
                    AND expires_at > now()
              RETURNING client_id, uid, roles, redirect_uri,
                        code_challenge, code_challenge_method, scope, resource`,
                [await sha256Hex(code)]
            );
            const row = rows[0];
            if (!row) return null;
            return {
                clientId: String(row.client_id),
                uid: String(row.uid),
                roles: toStringArray(row.roles),
                redirectUri: String(row.redirect_uri),
                codeChallenge: String(row.code_challenge),
                codeChallengeMethod: String(row.code_challenge_method),
                scope: String(row.scope),
                resource: String(row.resource)
            };
        },

        async saveRefreshToken(token, record, expiresAt) {
            await exec(
                `INSERT INTO ${REFRESH}
                    (token_hash, family, client_id, uid, roles, scope, resource, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    await sha256Hex(token),
                    record.family,
                    record.clientId,
                    record.uid,
                    record.roles,
                    record.scope,
                    record.resource,
                    expiresAt.toISOString()
                ]
            );
        },

        async consumeRefreshToken(token) {
            const hash = await sha256Hex(token);

            const rows = await exec(
                `UPDATE ${REFRESH}
                    SET consumed_at = now()
                  WHERE token_hash = $1
                    AND consumed_at IS NULL
                    AND revoked_at IS NULL
                    AND expires_at > now()
              RETURNING family, client_id, uid, roles, scope, resource`,
                [hash]
            );

            const row = rows[0];
            if (row) {
                return {
                    family: String(row.family),
                    clientId: String(row.client_id),
                    uid: String(row.uid),
                    roles: toStringArray(row.roles),
                    scope: String(row.scope),
                    resource: String(row.resource)
                };
            }

            // No row matched. That is usually an expired or unknown token — but
            // it is also what a REPLAY looks like, and the two must not be
            // treated alike. A token that exists and is already consumed means
            // either the client is retrying a request whose response it never
            // saw, or somebody else has a copy. OAuth 2.1 requires the second
            // reading: revoke the whole family, because there is no way to tell
            // the legitimate holder from the thief, and leaving the chain alive
            // leaves the thief holding a valid credential.
            const replay = await exec(
                `SELECT family FROM ${REFRESH} WHERE token_hash = $1 AND consumed_at IS NOT NULL`,
                [hash]
            );
            const family = replay[0]?.family;
            if (family) {
                logger.error("[oauth] Refresh token replayed — revoking the whole family", { family });
                await exec(
                    `UPDATE ${REFRESH} SET revoked_at = now() WHERE family = $1 AND revoked_at IS NULL`,
                    [String(family)]
                );
            }
            return null;
        },

        async revokeFamily(family) {
            await exec(
                `UPDATE ${REFRESH} SET revoked_at = now() WHERE family = $1 AND revoked_at IS NULL`,
                [family]
            );
        },

        async revokeTokenForClient(token, clientId) {
            // One statement: revoke every sibling of the family the presented
            // token belongs to, but only when that token is this client's. A
            // token belonging to someone else matches nothing and changes
            // nothing — no read side effect, so presenting a stranger's token
            // here is inert rather than destructive.
            const revoked = await exec(
                `UPDATE ${REFRESH}
                    SET revoked_at = now()
                  WHERE revoked_at IS NULL
                    AND family = (
                        SELECT family FROM ${REFRESH}
                         WHERE token_hash = $1 AND client_id = $2
                    )
              RETURNING token_hash`,
                [await sha256Hex(token), clientId]
            );
            return revoked.length > 0;
        },

        async recordConsent(uid, clientId, scope) {
            await exec(
                `INSERT INTO ${CONSENTS} (uid, client_id, scope)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (uid, client_id)
                 DO UPDATE SET scope = EXCLUDED.scope, granted_at = now()`,
                [uid, clientId, scope]
            );
        },

        async listGrants(uid) {
            // LEFT JOIN on the client, so a consent whose client row has been
            // deleted still lists — as an unnamed entry the user can revoke.
            // An INNER JOIN would hide exactly the grants nobody can account
            // for, which are the ones worth showing.
            const rows = await exec(
                `SELECT c.client_id,
                        COALESCE(cl.client_name, '(unknown application)') AS client_name,
                        c.scope,
                        c.granted_at,
                        (SELECT count(*)::int
                           FROM ${REFRESH} r
                          WHERE r.uid = c.uid
                            AND r.client_id = c.client_id
                            AND r.revoked_at IS NULL
                            AND r.consumed_at IS NULL
                            AND r.expires_at > now()) AS active_tokens
                   FROM ${CONSENTS} c
                   LEFT JOIN ${CLIENTS} cl ON cl.client_id = c.client_id
                  WHERE c.uid = $1
                  ORDER BY c.granted_at DESC`,
                [uid]
            );
            return rows.map(row => ({
                clientId: String(row.client_id),
                clientName: String(row.client_name),
                scope: String(row.scope),
                grantedAt: new Date(String(row.granted_at)).toISOString(),
                activeTokens: Number(row.active_tokens ?? 0)
            }));
        },

        async revokeGrant(uid, clientId) {
            // Tokens first, then the consent. If this is interrupted between the
            // two, the user is left with a consent row and no live tokens —
            // which re-prompts on the next authorization and grants nothing in
            // the meantime. The other order would leave live tokens behind with
            // no record that the user had ever approved them.
            const revoked = await exec(
                `UPDATE ${REFRESH}
                    SET revoked_at = now()
                  WHERE uid = $1 AND client_id = $2 AND revoked_at IS NULL
              RETURNING token_hash`,
                [uid, clientId]
            );
            const consent = await exec(
                `DELETE FROM ${CONSENTS} WHERE uid = $1 AND client_id = $2 RETURNING client_id`,
                [uid, clientId]
            );

            const found = revoked.length > 0 || consent.length > 0;
            if (found) {
                logger.info("[oauth] Grant revoked by the user", {
                    uid, clientId, refreshTokensRevoked: revoked.length
                });
            }
            return found;
        }
    };
}

/**
 * Read a `text[]` column back as strings.
 *
 * Drivers disagree about array columns: `pg` parses them into a JS array, while
 * a driver that goes through a generic JSON path can hand back the Postgres
 * literal `{a,b}`. Normalising here keeps that disagreement out of every caller.
 */
function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string") {
        const inner = value.replace(/^\{|\}$/g, "");
        if (!inner) return [];
        return inner.split(",").map(s => s.replace(/^"|"$/g, ""));
    }
    return [];
}
