import { Hono } from "hono";
import type { HonoEnv } from "../api/types";
import { getJwks } from "./jwt";

/**
 * `GET /.well-known/jwks.json` — the public keys that verify this issuer's
 * access tokens.
 *
 * Deliberately unauthenticated and world-readable: the whole point is that a
 * gateway, an edge function or a neighbouring service can check a Rebase token
 * without being trusted with anything. Public keys are not a secret, and
 * `jwt-keys.ts` derives what is served here from the public half of each pair.
 *
 * Mounted at the root rather than under `basePath`, because `/.well-known/` is
 * where every verifier looks — an issuer of `https://api.example.com` implies
 * `https://api.example.com/.well-known/jwks.json`, whatever the API happens to
 * be prefixed with.
 */
export function createJwksRoutes(): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    router.get("/jwks.json", (c) => {
        const jwks = getJwks();

        // Verifiers cache JWKS and re-fetch on an unknown `kid`, so a long TTL
        // is safe and a short one is wasteful — adding a key is not a reason to
        // invalidate anyone's cache, because nothing signs with it until the
        // deploy that makes it active, and a verifier that meets an unfamiliar
        // `kid` refetches anyway. Five minutes is the interval a rotation is
        // measured against, not the tokens' lifetime.
        c.header("Cache-Control", "public, max-age=300");
        return c.json(jwks);
    });

    return router;
}
