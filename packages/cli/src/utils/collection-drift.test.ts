/**
 * The reported symptom these exist for: `rebase dev` printed "your schema may
 * be out of sync — run `rebase schema generate`, `rebase db push`" every time a
 * `config/collections/firestore/*.ts` file was saved, in a project whose
 * Firestore collections have no Drizzle schema and no database to push to.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { affectsSqlSchema, declaresRelationalCollection, isLoadedCollectionFile } from "./collection-drift";

describe("isLoadedCollectionFile", () => {
    it("accepts a top-level collection module", () => {
        expect(isLoadedCollectionFile("users.ts")).toBe(true);
        expect(isLoadedCollectionFile("users.js")).toBe(true);
    });

    it("rejects anything in a subdirectory — the loader does not recurse", () => {
        expect(isLoadedCollectionFile("firestore/exercises.ts")).toBe(false);
        expect(isLoadedCollectionFile("firestore/content/articles.ts")).toBe(false);
        expect(isLoadedCollectionFile(path.join("firestore", "exercises.ts"))).toBe(false);
    });

    it("rejects the files the loader itself skips", () => {
        expect(isLoadedCollectionFile("index.ts")).toBe(false);
        expect(isLoadedCollectionFile("index.js")).toBe(false);
        expect(isLoadedCollectionFile("users.test.ts")).toBe(false);
        expect(isLoadedCollectionFile("users.d.ts")).toBe(false);
        expect(isLoadedCollectionFile("._users.ts")).toBe(false);
        expect(isLoadedCollectionFile("shared.json")).toBe(false);
    });
});

describe("declaresRelationalCollection", () => {
    it("treats a collection with no engine as SQL — postgres is the default", () => {
        expect(declaresRelationalCollection('export default { slug: "users", properties: {} };')).toBe(true);
    });

    it("recognises a Firestore collection", () => {
        expect(declaresRelationalCollection(`
            export default {
                slug: "exercises",
                engine: "firestore",
                dataSource: "firestore",
                properties: {}
            };
        `)).toBe(false);
    });

    it("recognises a MongoDB collection", () => {
        expect(declaresRelationalCollection('const c = { engine: "mongodb" };')).toBe(false);
    });

    it("falls back to the dataSource key when no engine is declared", () => {
        // Matches `resolveDataSource` with no registry, which the CLI never has.
        expect(declaresRelationalCollection('const c = { dataSource: "firestore" };')).toBe(false);
        expect(declaresRelationalCollection('const c = { dataSource: "(default)" };')).toBe(true);
    });

    it("counts a file as SQL when any collection in it is", () => {
        // A subcollection file that also exports a Postgres one still drifts.
        expect(declaresRelationalCollection(`
            const locales = { engine: "firestore" };
            const audit = { engine: "postgres" };
        `)).toBe(true);
    });

    it("counts an unknown engine as SQL rather than going quiet", () => {
        expect(declaresRelationalCollection('const c = { engine: "cockroach" };')).toBe(true);
    });

    it("ignores an engine named in a comment", () => {
        // Otherwise a docblock mentioning Firestore would silence the warning
        // for the Postgres collection the file actually declares.
        expect(declaresRelationalCollection(`
            /** Mirrors the engine: "firestore" collection of the same name. */
            export default { slug: "users", properties: {} };
        `)).toBe(true);
        expect(declaresRelationalCollection(`
            // engine: "firestore"
            export default { slug: "users" };
        `)).toBe(true);
    });
});

describe("affectsSqlSchema", () => {
    let dir: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-drift-"));
        fs.mkdirSync(path.join(dir, "firestore"), { recursive: true });
        fs.writeFileSync(path.join(dir, "users.ts"), 'export default { slug: "users" };');
        fs.writeFileSync(path.join(dir, "events.ts"), 'export default { slug: "events", engine: "firestore" };');
        fs.writeFileSync(path.join(dir, "firestore", "exercises.ts"), 'export default { slug: "exercises", engine: "firestore" };');
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("warns for a SQL collection", () => {
        expect(affectsSqlSchema(dir, "users.ts")).toBe(true);
    });

    it("stays quiet for a Firestore collection at the top level", () => {
        expect(affectsSqlSchema(dir, "events.ts")).toBe(false);
    });

    it("stays quiet for a file the loader never reads", () => {
        expect(affectsSqlSchema(dir, "firestore/exercises.ts")).toBe(false);
    });

    it("warns when the file cannot be read", () => {
        expect(affectsSqlSchema(dir, "deleted-mid-edit.ts")).toBe(true);
    });
});
