import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { generateKeyPairSync } from "node:crypto";

import { resolveLiveSchemaOptions } from "../src/boot/options";
import { bootEnvExtension, type RebaseBootEnv } from "../src/boot/env";
import { BundleError } from "../src/boot/bundle";
import { logger } from "../src/utils/logger";

/**
 * Live schema editing from a built bundle is configured by environment
 * variables, because a bundle deployment has no code of its own to pass
 * `liveSchema.repository` from. It is opt-in: nothing is on unless
 * `REBASE_LIVE_SCHEMA_REPOSITORY` names where the commit goes, and a setting
 * that names a target but cannot reach it fails the boot rather than serving a
 * button that fails on press.
 */
function env(overrides: Record<string, string | undefined>): RebaseBootEnv {
    // Through the real schema, so a variable missing from it fails here.
    const parsed = bootEnvExtension.parse(overrides);
    return { NODE_ENV: "production", ...parsed } as unknown as RebaseBootEnv;
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe("resolveLiveSchemaOptions", () => {
    it("is off when nothing is set — a bundle that does not opt in changes nothing", () => {
        expect(resolveLiveSchemaOptions(env({}))).toBeUndefined();
    });

    it("builds the repository from a token", () => {
        expect(resolveLiveSchemaOptions(env({
            REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop",
            REBASE_LIVE_SCHEMA_GITHUB_TOKEN: "github_pat_x"
        }))).toEqual({
            repository: {
                kind: "github",
                owner: "acme",
                repo: "shop",
                branch: "main",
                collectionsPath: "config/collections",
                auth: { kind: "token", token: "github_pat_x" }
            }
        });
    });

    it("takes the branch and the collections path", () => {
        const options = resolveLiveSchemaOptions(env({
            REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop",
            REBASE_LIVE_SCHEMA_BRANCH: "schema-edits",
            REBASE_LIVE_SCHEMA_COLLECTIONS_PATH: "app/config/collections/",
            REBASE_LIVE_SCHEMA_GITHUB_TOKEN: "github_pat_x"
        }));
        expect(options?.repository).toMatchObject({
            branch: "schema-edits",
            collectionsPath: "app/config/collections"
        });
    });

    it("builds the repository from a GitHub App, normalising the key", () => {
        const { privateKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            privateKeyEncoding: { type: "pkcs1", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" }
        });
        const options = resolveLiveSchemaOptions(env({
            REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop",
            REBASE_LIVE_SCHEMA_GITHUB_APP_ID: "123",
            REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID: "456",
            REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY: Buffer.from(privateKey).toString("base64")
        }));
        expect(options?.repository?.auth).toEqual({
            kind: "app",
            appId: "123",
            installationId: "456",
            privateKey
        });
    });

    it("fails the boot when the repository is named with no credential", () => {
        expect(() => resolveLiveSchemaOptions(env({ REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop" })))
            .toThrow(BundleError);
        expect(() => resolveLiveSchemaOptions(env({ REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop" })))
            .toThrow(/REBASE_LIVE_SCHEMA_GITHUB_TOKEN/);
    });

    it("fails the boot on a repository that is not owner/name", () => {
        for (const value of ["shop", "https://github.com/acme/shop", "acme/shop/extra", "acme/"]) {
            expect(() => resolveLiveSchemaOptions(env({
                REBASE_LIVE_SCHEMA_REPOSITORY: value,
                REBASE_LIVE_SCHEMA_GITHUB_TOKEN: "github_pat_x"
            }))).toThrow(/owner\/name/);
        }
    });

    it("fails the boot on half a GitHub App, naming what is missing", () => {
        expect(() => resolveLiveSchemaOptions(env({
            REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop",
            REBASE_LIVE_SCHEMA_GITHUB_APP_ID: "123"
        }))).toThrow(/REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID.*REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY/s);
    });

    it("fails the boot when both a token and an app are set", () => {
        expect(() => resolveLiveSchemaOptions(env({
            REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop",
            REBASE_LIVE_SCHEMA_GITHUB_TOKEN: "github_pat_x",
            REBASE_LIVE_SCHEMA_GITHUB_APP_ID: "123",
            REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID: "456",
            REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\\nx\\n-----END RSA PRIVATE KEY-----"
        }))).toThrow(/both/);
    });

    it("refuses a collections path that leaves the repository", () => {
        expect(() => resolveLiveSchemaOptions(env({
            REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop",
            REBASE_LIVE_SCHEMA_GITHUB_TOKEN: "github_pat_x",
            REBASE_LIVE_SCHEMA_COLLECTIONS_PATH: "../elsewhere"
        }))).toThrow(/REBASE_LIVE_SCHEMA_COLLECTIONS_PATH/);
    });

    it("warns, and stays off, when a credential is set without a repository", () => {
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
        expect(resolveLiveSchemaOptions(env({ REBASE_LIVE_SCHEMA_GITHUB_TOKEN: "github_pat_x" }))).toBeUndefined();
        expect(warn.mock.calls.flat().join(" ")).toMatch(/REBASE_LIVE_SCHEMA_REPOSITORY/);
    });
});

describe("the bundle boot reads it", () => {
    it("passes the resolved options to the backend — an env var nothing reads is the bug class this closes", () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const source: string = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/boot/boot.ts"), "utf8");
        expect(source).toMatch(/const liveSchema = resolveLiveSchemaOptions\(env\);/);
        const call = source.slice(source.indexOf("= await createRebaseBackend({"));
        expect(call.slice(0, call.indexOf("\n    });"))).toMatch(/\n\s+liveSchema,?\s*$/);
    });
});
