import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { generateKeyPairSync } from "node:crypto";

import { resolveLiveSchemaOptions, type LiveSchemaEnv } from "../src/boot/options";
import { bootEnvExtension } from "../src/boot/env";
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
function env(overrides: Record<string, string | undefined>): LiveSchemaEnv {
    // Through the real schema, so a variable missing from it fails here.
    return bootEnvExtension.parse(overrides);
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
                schemaPath: "backend/schema",
                auth: { kind: "token", token: "github_pat_x" }
            }
        });
    });

    it("takes the branch and the schema path", () => {
        const options = resolveLiveSchemaOptions(env({
            REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop",
            REBASE_LIVE_SCHEMA_BRANCH: "schema-edits",
            REBASE_LIVE_SCHEMA_PATH: "app/backend/schema/",
            REBASE_LIVE_SCHEMA_GITHUB_TOKEN: "github_pat_x"
        }));
        expect(options?.repository).toMatchObject({
            branch: "schema-edits",
            schemaPath: "app/backend/schema"
        });
    });

    it("fails the boot on the removed REBASE_LIVE_SCHEMA_COLLECTIONS_PATH, naming what replaced it", () => {
        for (const repository of [{}, { REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop", REBASE_LIVE_SCHEMA_GITHUB_TOKEN: "github_pat_x" }]) {
            expect(() => resolveLiveSchemaOptions(env({ ...repository, REBASE_LIVE_SCHEMA_COLLECTIONS_PATH: "config/collections" })))
                .toThrow(/REBASE_LIVE_SCHEMA_COLLECTIONS_PATH was removed[\s\S]*REBASE_LIVE_SCHEMA_PATH/);
        }
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

    it("refuses a schema path that leaves the repository", () => {
        expect(() => resolveLiveSchemaOptions(env({
            REBASE_LIVE_SCHEMA_REPOSITORY: "acme/shop",
            REBASE_LIVE_SCHEMA_GITHUB_TOKEN: "github_pat_x",
            REBASE_LIVE_SCHEMA_PATH: "../elsewhere"
        }))).toThrow(/REBASE_LIVE_SCHEMA_PATH must be a path inside the repository/);
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
