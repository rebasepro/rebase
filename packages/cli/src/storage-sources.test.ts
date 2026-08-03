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

describe("rebase.json storage block", () => {
    it("is optional — omitting it means one default source", () => {
        const { manifest, issues } = validateManifest(base);
        expect(issues).toEqual([]);
        expect(manifest?.storage).toBeUndefined();
    });

    it("carries declared sources through validation", () => {
        const { manifest, issues } = validateManifest({
            ...base,
            storage: {
                "(default)": { engine: "s3" },
                media: { engine: "s3",
label: "Media" },
                avatars: { engine: "firebase",
transport: "direct" }
            }
        });
        expect(issues).toEqual([]);
        expect(manifest?.storage).toEqual({
            "(default)": { engine: "s3" },
            media: { engine: "s3",
label: "Media" },
            avatars: { engine: "firebase",
transport: "direct" }
        });
    });

    it("requires an engine", () => {
        const { issues } = validateManifest({ ...base,
storage: { media: { label: "Media" } } });
        expect(issues).toHaveLength(1);
        expect(issues[0].path).toBe("storage.media.engine");
    });

    it("rejects an unknown transport", () => {
        const { issues } = validateManifest({
            ...base,
            storage: { media: { engine: "s3",
transport: "sideways" } }
        });
        expect(issues[0].path).toBe("storage.media.transport");
    });

    it("rejects two keys that would read the same environment variables", () => {
        // The whole reason this is validated at all: without it, `media_cdn`
        // silently reads `media-cdn`'s bucket and credentials.
        const { issues } = validateManifest({
            ...base,
            storage: { "media-cdn": { engine: "s3" },
media_cdn: { engine: "s3" } }
        });
        expect(issues).toHaveLength(1);
        expect(issues[0].message).toMatch(/same environment variable suffix/);
    });

    it("rejects a key that cannot become a variable name", () => {
        const { issues } = validateManifest({ ...base,
storage: { "---": { engine: "s3" } } });
        expect(issues[0].path).toBe("storage.---");
    });

    it("rejects a non-object storage block", () => {
        const { issues } = validateManifest({ ...base,
storage: ["media"] });
        expect(issues[0].path).toBe("storage");
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
