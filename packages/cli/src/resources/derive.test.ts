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

    it("records a cron under the id the scheduler runs it as, and a function by its filename", async () => {
        // Both by filename: the same identity the routes, the Studio and
        // `REBASE_FUNCTIONS_ONLY` use. A host reading the graph now knows the
        // schedule and the zone before it runs anything.
        const cronsDir = path.join(root, "backend", "crons");
        const functionsDir = path.join(root, "backend", "functions");
        fs.mkdirSync(cronsDir, { recursive: true });
        fs.mkdirSync(functionsDir, { recursive: true });
        fs.writeFileSync(path.join(cronsDir, `nightly_${process.pid}.ts`), `
            import { defineCron } from "@rebasepro/server";
            export default defineCron({
                name: "Nightly",
                schedule: "0 3 * * *",
                timezone: "Europe/Madrid",
                async handler() {}
            });
        `);
        fs.writeFileSync(path.join(functionsDir, `hello_${process.pid}.ts`), `
            import { defineFunction } from "@rebasepro/server/functions";
            import fs from "fs";
            export default defineFunction((app) => { app.get("/", c => c.json({ ok: fs.existsSync("/") })); });
        `);
        writeResources(`export const nothing = 1;`);

        const { graph, issues } = await deriveResourceGraph({ configDir, cronsDir, functionsDir, projectRoot: root });
        expect(issues).toEqual([]);
        const cron = graph.resources.find(r => r.kind === "cron");
        expect(cron?.key).toBe(`nightly_${process.pid}`);
        expect(cron?.options).toMatchObject({ schedule: "0 3 * * *", timezone: "Europe/Madrid" });
        const fn = graph.resources.find(r => r.kind === "function");
        expect(fn?.key).toBe(`hello_${process.pid}`);
        expect(fn?.options).toMatchObject({ portable: false });
        expect(fn?.options.requires).toEqual(["imports the Node built-in \"fs\""]);
    });

    it("records who uses what: collections by dataSource, properties by bucket, functions by import", async () => {
        // The map a split needs and a console needs for "what breaks if I
        // remove this". Recorded from the evaluated collections and the
        // functions' imports, never from the constructors, which only know
        // that a resource exists.
        const k = process.pid;
        fs.mkdirSync(path.join(configDir, "collections"), { recursive: true });
        writeResources(`
            import { database, bucket } from "@rebasepro/types";
            export const analytics = database("analytics_${k}");
            export const media = bucket("media_${k}", { engine: "s3" });
        `);
        fs.writeFileSync(path.join(configDir, "collections", "events.ts"), `
            import { analytics, media } from "../resources";
            export default {
                slug: "events", name: "Events", dataSource: analytics,
                properties: { cover: { type: "string", storage: { storageSource: media } } }
            };
        `);
        const functionsDir = path.join(root, "backend", "functions");
        fs.mkdirSync(functionsDir, { recursive: true });
        fs.writeFileSync(path.join(functionsDir, `report_${k}.ts`), `
            import { media as photos } from "../../config/resources";
            export default (app: unknown) => app;
        `);

        const { graph, issues } = await deriveResourceGraph({ configDir, functionsDir, projectRoot: root });
        expect(issues).toEqual([]);
        expect(graph.resources.find(r => r.key === `analytics_${k}`)?.usedBy).toEqual(["collection:events"]);
        expect(graph.resources.find(r => r.key === `media_${k}`)?.usedBy)
            .toEqual([`function:report_${k}`, "property:events.cover"]);
        // A handle written where a key belongs is recorded as the key: the
        // collection is data past this point, and the edge came from it.
        expect(serializeResourceGraph(graph)).toContain('"usedBy"');
    });

    it("names a collection routed to a database nothing declares", async () => {
        // Boot refuses this with the variable name; the derive step says it
        // earlier, with the declaration to add.
        fs.mkdirSync(path.join(configDir, "collections"), { recursive: true });
        writeResources(`export const nothing = 1;`);
        fs.writeFileSync(path.join(configDir, "collections", "facts.ts"), `
            export default { slug: "facts", name: "Facts", dataSource: "warehouse", properties: {} };
        `);
        const { issues } = await deriveResourceGraph({ configDir });
        expect(issues.map(i => i.path)).toEqual(["collection.facts"]);
        expect(issues[0].message).toMatch(/database\("warehouse"\)/);
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
