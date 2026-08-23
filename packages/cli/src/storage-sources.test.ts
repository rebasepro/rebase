import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateManifest } from "./manifest";
import { detectStorageAuthorize } from "./bundle";

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-storage-sources-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true,
force: true });
});

const base = { rebase: "^1",
apps: { backend: { type: "backend",
runtime: "managed" } } };

/**
 * The `storage` block is gone.
 *
 * It used to be validated here in detail — engine required, transport a closed
 * set, two keys never allowed to collapse onto one environment variable suffix.
 * All of that is still enforced, at the declaration instead: `bucket("media",
 * { engine: "s3" })` refuses an unknown engine at the call site, and
 * `rebase resources` reports a suffix collision with both keys named.
 *
 * What is left to test here is that the block is REFUSED rather than ignored.
 * A key that still parses and quietly does nothing is the failure this whole
 * change removes — and it is the specific failure this block had, because the
 * runtime used to merge it with the code's declarations and let it win.
 */
describe("rebase.json storage block", () => {
    it("is refused, naming the replacement", () => {
        const { issues } = validateManifest({
            ...base,
            storage: { media: { engine: "s3" } }
        });
        expect(issues).toHaveLength(1);
        expect(issues[0].path).toBe("storage");
        expect(issues[0].message).toMatch(/no longer read/);
        expect(issues[0].message).toMatch(/bucket\("media", \{ engine: "s3" \}\)/);
        expect(issues[0].message).toMatch(/rebase resources --write/);
    });

    it("says why it is refused rather than ignored", () => {
        const { issues } = validateManifest({ ...base, storage: { media: { engine: "s3" } } });
        expect(issues[0].message).toMatch(/merged with the code's declarations and silently win/);
    });

    it("is refused however malformed it is, because the shape no longer matters", () => {
        // Previously each of these produced its own targeted issue. There is
        // nothing to validate now — the block itself is the error.
        for (const storage of [{ media: { label: "no engine" } }, { media: { engine: "s3", transport: "sideways" } }, { "---": { engine: "s3" } }, ["media"]]) {
            const { issues } = validateManifest({ ...base, storage });
            expect(issues).toHaveLength(1);
            expect(issues[0].path).toBe("storage");
        }
    });

    it("omitting it is still the ordinary case", () => {
        const { manifest, issues } = validateManifest(base);
        expect(issues).toEqual([]);
        expect(manifest?.storage).toBeUndefined();
    });
});

describe("detectStorageAuthorize", () => {
    const writeConfig = (files: Record<string, string>): string => {
        const dir = path.join(scratch, "config");
        fs.mkdirSync(dir, { recursive: true });
        for (const [name, content] of Object.entries(files)) {
            fs.writeFileSync(path.join(dir, name), content, "utf8");
        }
        return dir;
    };

    it("finds a directly exported hook", () => {
        expect(detectStorageAuthorize(writeConfig({
            "index.js": "export const storageAuthorize = () => true;"
        }))).toBe(true);
    });

    it("finds a named re-export", () => {
        expect(detectStorageAuthorize(writeConfig({
            "index.js": 'export { storageAuthorize } from "./storage.js";'
        }))).toBe(true);
    });

    it("finds a renamed re-export", () => {
        expect(detectStorageAuthorize(writeConfig({
            "index.js": 'export { authorize as storageAuthorize } from "./storage.js";'
        }))).toBe(true);
    });

    it("follows a wildcard re-export", () => {
        // The blind spot this test exists for: a barrel is an ordinary way to
        // write a config index, and reading it as "no hook" rejected correct
        // deploys, telling the developer to add a hook they had already written.
        expect(detectStorageAuthorize(writeConfig({
            "index.js": 'export * from "./storage.js";',
            "storage.js": "export const storageAuthorize = () => true;"
        }))).toBe(true);
    });

    it("follows a wildcard chain through several barrels", () => {
        expect(detectStorageAuthorize(writeConfig({
            "index.js": 'export * from "./a.js";',
            "a.js": 'export * from "./b.js";',
            "b.js": "export function storageAuthorize() { return true; }"
        }))).toBe(true);
    });

    it("resolves a .js specifier that only exists as .ts", () => {
        expect(detectStorageAuthorize(writeConfig({
            "index.ts": 'export * from "./storage.js";',
            "storage.ts": "export const storageAuthorize = () => true;"
        }))).toBe(true);
    });

    it("still reports false when no hook exists anywhere", () => {
        expect(detectStorageAuthorize(writeConfig({
            "index.js": 'export * from "./storage.js";',
            "storage.js": "export const collections = [];"
        }))).toBe(false);
    });

    it("does not follow bare package specifiers", () => {
        expect(detectStorageAuthorize(writeConfig({
            "index.js": 'export * from "@rebasepro/server";'
        }))).toBe(false);
    });

    it("is false with no config index at all", () => {
        expect(detectStorageAuthorize(path.join(scratch, "missing"))).toBe(false);
    });
});
