/**
 * The bundle manifest the CLI emits, pinned as a file the control plane reads.
 *
 * `tooling/contracts/bundle-manifest.json` is written from
 * `composeBundleManifest` with fixed inputs, so it is the SHAPE a current CLI
 * produces with every volatile field held still. The saas repository's
 * `bundle-manifest-contract.test.ts` reads that same file and asserts its
 * intake accepts it and its deploy finds every resource in it.
 *
 * That is the test that was missing on 2026-08-23, when buckets moved from
 * `storage.sources` into `resources`: the CLI's suite passed, the control
 * plane's suite passed, and for two weeks every bucket a current CLI declared
 * arrived at the platform as nothing. Two green suites and a broken product
 * is what a seam with no test across it looks like.
 *
 * Run with REBASE_UPDATE_CONTRACTS=1 to rewrite the file after a deliberate
 * change to the manifest shape — and then make the control plane's test pass
 * against the new one before shipping either side.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { composeBundleManifest } from "./bundle";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONTRACT_FILE = path.resolve(HERE, "../../../tooling/contracts/bundle-manifest.json");

/** A representative project: one of every kind, every option a host reads. */
export function exampleManifest() {
    return composeBundleManifest({
        runtimeRange: "^1",
        builtAgainst: "1.0.0",
        schemaVersion: "v1:example",
        appName: "backend",
        entry: {
            config: "config",
            collections: "config/collections",
            functions: "backend/functions",
            crons: "backend/crons",
            schema: "backend/src/schema.generated.js",
            usersCollection: "config/collections/users.js"
        },
        collectionSlugs: ["posts", "events"],
        functions: [{ name: "hello", file: "backend/functions/hello.js", portable: true }],
        nativeModules: [],
        declaresStorageAuthorize: true,
        resources: {
            version: 1,
            resources: [
                { kind: "bucket", key: "media", engine: "s3", transport: "server", options: { account: "minio" }, usedBy: ["property:posts.cover"] },
                { kind: "cron", key: "nightly", engine: "scheduler", transport: "server", options: { schedule: "0 3 * * *", timezone: "Europe/Madrid" } },
                { kind: "database", key: "(default)", engine: "postgres", transport: "server", options: { extensions: ["vector"] } },
                { kind: "database", key: "analytics", engine: "postgres", transport: "server", options: {}, usedBy: ["collection:events"] },
                { kind: "function", key: "hello", engine: "http", transport: "server", options: { file: "backend/functions/hello.ts", portable: true } },
                { kind: "queue", key: "thumbnails", engine: "jobs", transport: "server", options: {} },
                { kind: "topic", key: "signups", engine: "jobs", transport: "server", options: {} }
            ]
        },
        declaredDeps: { "@rebasepro/server": "^1.0.0" },
        build: { cli: "0.0.0-contract", node: "22", createdAt: "2026-01-01T00:00:00.000Z" }
    });
}

describe("the bundle manifest contract", () => {
    it("matches the committed file the control plane's tests read", () => {
        const expected = `${JSON.stringify(exampleManifest(), null, 2)}\n`;
        if (process.env.REBASE_UPDATE_CONTRACTS) {
            fs.mkdirSync(path.dirname(CONTRACT_FILE), { recursive: true });
            fs.writeFileSync(CONTRACT_FILE, expected);
        }
        const committed = fs.existsSync(CONTRACT_FILE) ? fs.readFileSync(CONTRACT_FILE, "utf8") : null;
        expect(committed, `${path.relative(process.cwd(), CONTRACT_FILE)} is missing or stale — run with REBASE_UPDATE_CONTRACTS=1, then make saas's contract test pass`)
            .toBe(expected);
    });

    it("carries buckets in the graph, never in storage.sources", () => {
        // The exact drift the contract exists for.
        const manifest = exampleManifest() as { storage?: Record<string, unknown>; resources?: { resources: { kind: string }[] } };
        expect(manifest.storage).toEqual({ authorize: true });
        expect("sources" in (manifest.storage ?? {})).toBe(false);
        expect(manifest.resources?.resources.some(r => r.kind === "bucket")).toBe(true);
    });
});
