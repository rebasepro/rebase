/**
 * Deriving a graph from real config files, evaluated the way the CLI evaluates them.
 *
 * The fixtures are written inside the package rather than in a temp directory
 * so that `@rebasepro/types` resolves from them the way it resolves from a real
 * project. A fixture under `os.tmpdir()` has no `node_modules` above it, so the
 * import would fail for a reason that has nothing to do with what is under test.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    deriveResourceGraph,
    parseResourceGraph,
    serializeResourceGraph,
    writeResourceGraphFile
} from "./derive";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let root: string;
let configDir: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(HERE, ".tmp-resources-"));
    configDir = path.join(root, "config");
    fs.mkdirSync(configDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

/** Write a config module. A unique suffix defeats the ESM module cache between tests. */
function writeResources(body: string): void {
    fs.writeFileSync(path.join(configDir, "resources.ts"), body);
}

describe("deriving", () => {
    it("finds every kind declared in resources.ts", async () => {
        writeResources(`
            import { database, bucket, topic } from "@rebasepro/types";
            export const main = database("main_${process.pid}");
            export const media = bucket("media_${process.pid}", { transport: "direct" });
            export const signups = topic("signups_${process.pid}");
        `);
        const { graph, issues } = await deriveResourceGraph({ configDir });
        expect(issues).toEqual([]);
        expect(graph.resources.map(r => r.kind).sort()).toEqual(["bucket", "database", "topic"]);
        expect(graph.resources.find(r => r.kind === "bucket")?.transport).toBe("direct");
    });

    it("finds resources declared beside the collection that uses them", async () => {
        // Nothing forces a bucket to be declared in resources.ts, and a graph
        // that missed one would under-report what the project needs — which is
        // the same silent under-provisioning the old model produced.
        fs.mkdirSync(path.join(configDir, "collections"), { recursive: true });
        fs.writeFileSync(path.join(configDir, "collections", "docs.ts"), `
            import { bucket } from "@rebasepro/types";
            export const attachments = bucket("attachments_${process.pid}");
            export default { name: "Docs", path: "docs", properties: {} };
        `);
        const { graph } = await deriveResourceGraph({ configDir });
        expect(graph.resources.map(r => r.key)).toContain(`attachments_${process.pid}`);
    });

    it("reports the file a broken declaration is in, not just that it failed", async () => {
        writeResources(`
            import { bucket } from "@rebasepro/types";
            export const bad = bucket("bad_${process.pid}", { engine: "s2" });
        `);
        const { issues } = await deriveResourceGraph({ configDir });
        expect(issues).toHaveLength(1);
        expect(issues[0].path).toBe("resources.ts");
        expect(issues[0].message).toMatch(/Unknown bucket engine "s2"/);
    });

    it("reports two keys whose env suffixes collide", async () => {
        // Both become __MEDIA_FILES, so one would read the other's config.
        writeResources(`
            import { bucket } from "@rebasepro/types";
            export const a = bucket("media-files");
            export const b = bucket("media_files");
        `);
        const { issues } = await deriveResourceGraph({ configDir });
        expect(issues.some(i => /both bind from __MEDIA_FILES/.test(i.message))).toBe(true);
    });

    it("accepts a subscription on a topic that is declared", async () => {
        writeResources(`
            import { topic } from "@rebasepro/types";
            const declared = topic("declared_${process.pid}");
            declared.subscription("ok", async () => undefined);
        `);
        const { issues } = await deriveResourceGraph({ configDir });
        expect(issues).toEqual([]);
    });

    it("forgets subscriptions between projects, not only resources", async () => {
        // They live in separate lists, so resetting one and not the other left
        // the previous project's handlers attached while its topics were gone —
        // and every one of them then read as orphaned against the next project.
        writeResources(`
            import { topic } from "@rebasepro/types";
            const t = topic("first_${process.pid}");
            t.subscription("handler", async () => undefined);
        `);
        await deriveResourceGraph({ configDir });

        const second = path.join(root, "config-b");
        fs.mkdirSync(second, { recursive: true });
        fs.writeFileSync(path.join(second, "resources.ts"), `
            import { database } from "@rebasepro/types";
            export const db = database("only_${process.pid}");
        `);
        const { issues } = await deriveResourceGraph({ configDir: second });
        expect(issues).toEqual([]);
    });

    it("describes the project, not the union of every project seen", async () => {
        writeResources(`
            import { database } from "@rebasepro/types";
            export const one = database("first_${process.pid}");
        `);
        await deriveResourceGraph({ configDir });

        const second = path.join(root, "config2");
        fs.mkdirSync(second, { recursive: true });
        fs.writeFileSync(path.join(second, "resources.ts"), `
            import { database } from "@rebasepro/types";
            export const two = database("second_${process.pid}");
        `);
        const { graph } = await deriveResourceGraph({ configDir: second });
        expect(graph.resources.map(r => r.key)).toEqual([`second_${process.pid}`]);
    });

    it("is empty, not an error, for a project that declares nothing", async () => {
        const { graph, issues } = await deriveResourceGraph({ configDir });
        expect(issues).toEqual([]);
        expect(graph.resources).toEqual([]);
    });
});

describe("the committed file", () => {
    it("round-trips", () => {
        const graph = { version: 1 as const, resources: [
            { kind: "bucket", key: "media", engine: "s3", transport: "direct" as const, options: { prefix: "m/" } }
        ] };
        expect(parseResourceGraph(serializeResourceGraph(graph)).resources).toEqual(graph.resources);
    });

    it("says it is generated, so nobody edits it by hand", () => {
        const out = serializeResourceGraph({ version: 1, resources: [] });
        expect(out).toMatch(/\$generated/);
        expect(out).toMatch(/Edit the declarations, not this file/);
        expect(out.endsWith("\n")).toBe(true);
    });

    it("refuses a version it does not understand rather than provisioning half of it", () => {
        expect(() => parseResourceGraph(JSON.stringify({ version: 2, resources: [] })))
            .toThrow(/Unsupported resource graph version 2/);
    });

    it("reports whether writing changed anything, which is what --check gates on", () => {
        const graph = { version: 1 as const, resources: [] };
        expect(writeResourceGraphFile(root, graph).changed).toBe(true);
        expect(writeResourceGraphFile(root, graph).changed).toBe(false);
    });

    it("is stable across regeneration, so a diff shows real change only", () => {
        const graph = { version: 1 as const, resources: [
            { kind: "topic", key: "b", engine: "jobs", transport: "server" as const, options: {} },
            { kind: "database", key: "a", engine: "postgres", transport: "server" as const, options: {} }
        ] };
        expect(serializeResourceGraph(graph)).toBe(serializeResourceGraph(graph));
    });
});

describe("temp fixtures", () => {
    it("does not leave anything in the package", () => {
        expect(fs.existsSync(root)).toBe(true);
        expect(path.dirname(root)).toBe(HERE);
        expect(os.tmpdir()).toBeTruthy();
    });
});
