/**
 * Deriving a graph from real config files, evaluated the way the CLI evaluates them.
 *
 * The fixtures are written inside the package rather than in a temp directory
 * so that `@rebasepro/types` resolves from them the way it resolves from a real
 * project. A fixture under `os.tmpdir()` has no `node_modules` above it, so the
 * import would fail for a reason that has nothing to do with what is under test.
 *
 * At the package root, though, and not under `src/`: `printed-commands.test.ts`
 * walks every file under `src/` and reads it, and vitest runs the two files
 * concurrently, so a fixture that appeared and vanished mid-walk failed that
 * suite with `ENOENT … .tmp-resources-oXbjTz/config/collections/facts.ts`
 * about one full run in four. The `node_modules` these fixtures need is one
 * directory further up either way.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    describeIssue,
    deriveResourceGraph,
    parseResourceGraph,
    serializeResourceGraph,
    writeResourceGraphFile
} from "./derive";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `packages/cli` — inside the package, outside the tree other suites walk. */
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
let root: string;
let configDir: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-resources-"));
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

    it("reports a cron that will not load as one sentence, not a Zod dump", async () => {
        // A cron whose module scope validates the environment throws a
        // `ZodError`, whose `.message` is the JSON array of its issues. That
        // arrived here verbatim — ten lines of `{ "expected": "string", … }` —
        // with the explanation underneath it, so the reader met "Invalid input"
        // twice before reaching the sentence that says what to do.
        const cronsDir = path.join(root, "backend", "crons");
        fs.mkdirSync(cronsDir, { recursive: true });
        fs.writeFileSync(path.join(cronsDir, `envcron_${process.pid}.ts`), `
            import { defineCron } from "@rebasepro/server";
            const issues = [
                { expected: "string", code: "invalid_type", path: ["DATABASE_URL"],
                  message: "Invalid input: expected string, received undefined" }
            ];
            throw new Error(JSON.stringify(issues, null, 2));
            export default defineCron({ name: "Env", schedule: "0 3 * * *", async handler() {} });
        `);
        writeResources("export const nothing = 1;");

        const { issues } = await deriveResourceGraph({ configDir, cronsDir, projectRoot: root });

        expect(issues).toHaveLength(1);
        const message = issues[0].message;
        expect(message).toContain("Invalid input: expected string, received undefined");
        expect(message).toContain(`envcron_${process.pid}.ts`);
        // The serialisation itself is gone: no braces, no quoted keys.
        expect(message).not.toContain('"expected"');
        expect(message).not.toContain("invalid_type");
        // And the remedy is still there, once.
        expect(message).toContain("Move work that needs the deployment's environment inside the");
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
    it("live at the package root, never under src/", () => {
        // Under `src/` they raced `printed-commands.test.ts`, which reads every
        // file it finds there while this suite is creating and deleting them.
        expect(fs.existsSync(root)).toBe(true);
        expect(path.dirname(root)).toBe(PACKAGE_ROOT);
        expect(root.startsWith(path.join(PACKAGE_ROOT, "src"))).toBe(false);
        expect(os.tmpdir()).toBeTruthy();
    });
});

describe("a version skew is named as a version skew", () => {
    // Both directions arrive as an error about the reader's own file —
    // `resources.ts  The requested module '@rebasepro/types' does not provide an
    // export named 'queue'` — with nothing in it about either version, so the
    // reader goes looking for a typo in code they copied out of the docs. The
    // project running this suite is the workspace, so `@rebasepro/types`
    // resolves from it and the installed version is the workspace's own.
    const installed = JSON.parse(
        fs.readFileSync(path.join(PACKAGE_ROOT, "..", "types", "package.json"), "utf-8")
    ).version as string;

    const namedExport = new Error(
        "The requested module '@rebasepro/types' does not provide an export named 'queue'"
    );

    it("names the installed package version and the CLI's own", () => {
        const message = describeIssue(namedExport, PACKAGE_ROOT, "9.9.9");
        expect(message).toContain(`@rebasepro/types ${installed} is installed`);
        expect(message).toContain("this CLI is 9.9.9");
        expect(message).toContain("Run pnpm add @rebasepro/types@9.9.9");
        // The original error still leads: it says which file and which export.
        expect(message.startsWith("The requested module")).toBe(true);
        // One line, because every caller prints `path  message` on one row.
        expect(message).not.toContain("\n");
    });

    it("points at the CLI when the CLI is the older half", () => {
        const message = describeIssue(namedExport, PACKAGE_ROOT, "0.0.1");
        expect(message).toContain("which is older");
        expect(message).toContain(`Update the CLI to ${installed}`);
    });

    it("says nothing extra when the two agree", () => {
        expect(describeIssue(namedExport, PACKAGE_ROOT, installed)).toBe(namedExport.message);
    });

    it("handles a package the project does not have at all", () => {
        // A specifier nothing in the workspace provides, so the resolve really
        // fails rather than finding a copy the test did not mean.
        const missing = Object.assign(
            new Error("Cannot find package '@rebasepro/not-a-real-package' imported from resources.ts"),
            { code: "ERR_MODULE_NOT_FOUND" }
        );
        const message = describeIssue(missing, PACKAGE_ROOT, "9.9.9");
        expect(message).toContain("@rebasepro/not-a-real-package is not installed in this project");
        expect(message).toContain("Run pnpm add @rebasepro/not-a-real-package@9.9.9");
    });

    it("leaves an error that is not a skew alone", () => {
        const other = new Error("Unexpected token '}'");
        expect(describeIssue(other, PACKAGE_ROOT, "9.9.9")).toBe("Unexpected token '}'");
        // A missing export from a package nobody here publishes is not our skew.
        const foreign = new Error("The requested module 'zod' does not provide an export named 'z'");
        expect(describeIssue(foreign, PACKAGE_ROOT, "9.9.9")).toBe(foreign.message);
    });
});
