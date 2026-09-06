import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { resolveAuthOptions } from "../src/boot/options";
import type { RebaseBootEnv } from "../src/boot/env";
import type { RebaseAuthConfig } from "../src/init";
import * as authModule from "../src/auth";

/**
 * Every OAuth provider this package ships is reachable from the environment.
 *
 * `authentication.md` promised, for the managed runtime, "the provider
 * `*_CLIENT_ID` / `*_CLIENT_SECRET` pairs", and listed twelve providers. Three
 * of them had a pair. Setting `DISCORD_CLIENT_ID` on a bundle deployment did
 * nothing whatsoever: the key was not in the zod schema, so it was dropped
 * before anything could read it, `GET /api/auth/config` went on answering
 * `"enabledProviders":[]`, and nothing was logged. There is no second way in —
 * `BundleConfigExports` has no `auth` field, so a scaffold cannot supply the
 * config object either.
 *
 * The gate is written against the *directory*, not a list: adding
 * `foo-oauth.ts` with a factory and forgetting the environment is the failure,
 * and a list maintained by hand is exactly what did not get updated nine times.
 *
 * Three hops, because a break at any one of them is silent:
 *
 *   1. the file exists and exports its factory;
 *   2. `resolveAuthOptions` turns the env pair into a config field;
 *   3. `init.ts`'s provider table knows that field, so the config field becomes
 *      a provider — which is what `enabledProviders` is a map of.
 */

const AUTH_DIR = path.join(__dirname, "../src/auth");
const INIT = path.join(__dirname, "../src/init.ts");

/** `discord-oauth.ts` → `discord`. The directory is the source of truth. */
function shippedProviders(): string[] {
    return readdirSync(AUTH_DIR)
        .filter((file) => file.endsWith("-oauth.ts") && !file.endsWith(".test.ts"))
        .map((file) => file.replace(/-oauth\.ts$/, ""))
        .sort();
}

/**
 * The environment that configures one provider, in the shape its factory needs.
 * Apple is the exception the rule has to carry: it has no static client secret,
 * because `createAppleProvider` signs a short-lived ES256 JWT per exchange.
 */
function envFor(provider: string): Partial<RebaseBootEnv> {
    if (provider === "apple") {
        return {
            APPLE_CLIENT_ID: "com.example.service",
            APPLE_TEAM_ID: "TEAMID1234",
            APPLE_KEY_ID: "KEYID12345",
            APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----"
        } as Partial<RebaseBootEnv>;
    }
    const upper = provider.toUpperCase();
    return {
        [`${upper}_CLIENT_ID`]: `${provider}-client-id`,
        [`${upper}_CLIENT_SECRET`]: `${provider}-client-secret`
    } as Partial<RebaseBootEnv>;
}

const env = (overrides: Partial<RebaseBootEnv>): RebaseBootEnv =>
    ({ NODE_ENV: "development", APP_NAME: "Rebase", ...overrides }) as RebaseBootEnv;

describe("every shipped OAuth provider has an environment route", () => {
    const providers = shippedProviders();

    it("finds the twelve providers on disk", () => {
        // A guard whose enumeration silently returns nothing passes every
        // assertion below, so the count is asserted before it is used.
        expect(providers).toEqual([
            "apple", "bitbucket", "discord", "facebook", "github", "gitlab",
            "google", "linkedin", "microsoft", "slack", "spotify", "twitter"
        ]);
    });

    it.each(shippedProviders())("%s: the env pair reaches resolveAuthOptions", (provider) => {
        const auth = resolveAuthOptions(env(envFor(provider)), undefined) as Record<string, unknown>;

        expect(auth[provider]).toBeDefined();
        expect((auth[provider] as { clientId: string }).clientId).toBeTruthy();
    });

    it.each(shippedProviders())("%s: the config field is in init's provider table", (provider) => {
        // `enabledProviders` is `oauthProviders.map(p => p.id)`, and that array
        // is built from this table — a field nothing reads is a provider that
        // never appears in `GET /api/auth/config`.
        const init = readFileSync(INIT, "utf8");
        const row = new RegExp(`\\{\\s*key:\\s*"${provider}",\\s*factory:\\s*"(\\w+)"`).exec(init);

        expect(row).not.toBeNull();  // no OAUTH_PROVIDERS row for this provider in init.ts

        const factory = (authModule as unknown as Record<string, (cfg: unknown) => { id: string }>)[row![1]];
        expect(typeof factory).toBe("function");

        // And the provider it builds answers to the name the caller typed: the
        // id is what `enabledProviders` reports and what `/auth/:provider`
        // routes on, so a factory whose id drifted from its config key would
        // configure a provider nobody can reach.
        const auth = resolveAuthOptions(env(envFor(provider)), undefined) as Record<string, unknown>;
        expect(factory(auth[provider]).id).toBe(provider);
    });

    it("configures nothing when the environment is empty", () => {
        const auth = resolveAuthOptions(env({}), undefined) as Record<string, unknown>;
        for (const provider of providers) expect(auth[provider]).toBeUndefined();
    });

    it("does not configure a provider from half a pair", () => {
        // A client id with no secret builds a provider that fails at the first
        // sign-in rather than at boot, which is the worse of the two.
        const auth = resolveAuthOptions(env({ DISCORD_CLIENT_ID: "id-only" }), undefined);
        expect(auth.discord).toBeUndefined();
    });

    it("does not configure Apple from three of its four keys", () => {
        const auth = resolveAuthOptions(
            env({ APPLE_CLIENT_ID: "com.example.service", APPLE_TEAM_ID: "T", APPLE_KEY_ID: "K" }),
            undefined
        );
        expect(auth.apple).toBeUndefined();
    });

    it("names each provider in the boot env schema, so an unknown key is not silently dropped", () => {
        const schemas = [
            readFileSync(path.join(__dirname, "../src/boot/env.ts"), "utf8"),
            readFileSync(path.join(__dirname, "../src/env.ts"), "utf8")
        ].join("\n");

        for (const provider of providers) {
            const upper = provider.toUpperCase();
            expect(schemas).toContain(`${upper}_CLIENT_ID:`);
            const secretKey = provider === "apple" ? "APPLE_PRIVATE_KEY:" : `${upper}_CLIENT_SECRET:`;
            expect(schemas).toContain(secretKey);
        }
    });

    it("keeps every provider field on RebaseAuthConfig", () => {
        // A compile-time assertion: the union below fails to typecheck if a
        // provider field is renamed or removed, which is how a working env pair
        // becomes a config object nothing reads.
        const fields: readonly (keyof RebaseAuthConfig)[] = [
            "apple", "bitbucket", "discord", "facebook", "github", "gitlab",
            "google", "linkedin", "microsoft", "slack", "spotify", "twitter"
        ];
        expect([...fields].sort()).toEqual(providers);
    });
});
