/**
 * Editing a schema whose source is not on this machine.
 *
 * A bundle deployment ships compiled tables, so the schema directory is read
 * from the repository into a scratch directory, the editor previews the edit
 * there, and what it changed comes back as repository paths. The tests use a
 * real temp directory, a fake repository and the real editor, because the
 * thing worth pinning is the handoff: what gets fetched, what the editor is
 * given, what comes back, and what is left behind.
 */
import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";

import { previewRemoteSchema } from "../src/schema-edit/remote-source";
import type { SchemaEditRepository } from "../src/schema-edit/apply-schema-change";
import { TableSourceEditor } from "../src/api/table-source-editor";
import type { TablePatch } from "@rebasepro/types";
import { SCHEMA_FILES } from "./helpers/schema-source-fixture";

/** A repository holding whatever the test says it holds, that can list a directory as the GitHub one can. */
function repositoryWith(files: Record<string, string>): SchemaEditRepository & { reads: string[]; listed: string[] } {
    const reads: string[] = [];
    const listed: string[] = [];
    return {
        reads,
        listed,
        root: "owner/repo",
        currentBranch: async () => "main",
        dirtyPaths: async () => [],
        writeFiles: async () => {},
        commit: async () => "abc123",
        readFile: async (p: string) => { reads.push(p); return files[p]; },
        listFiles: async (dir: string) => { listed.push(dir); return Object.keys(files).filter(p => p.startsWith(`${dir}/`)); }
    };
}

const project = (root = "backend/schema"): Record<string, string> => ({
    ...Object.fromEntries(Object.entries(SCHEMA_FILES).map(([name, text]) => [`${root}/${name}`, text])),
    "backend/other.ts": "export const unrelated = 1;\n"
});

/** What `create-backend.ts` hands over: the real editor, previewing. */
const realEditor = (patches: readonly TablePatch[]) => async (dir: string) => {
    const edit = await new TableSourceEditor(dir).preview(patches);
    return { files: edit.files, result: edit.schema };
};

describe("previewing an edit of a remote schema", () => {
    it("fetches the whole schema directory and returns only what the edit changed", async () => {
        const repository = repositoryWith(project());
        const { files, result } = await previewRemoteSchema({
            repository,
            schemaPath: "backend/schema",
            preview: realEditor([{ op: "addColumn", table: "tags", key: "color", column: { type: { kind: "text" } } }])
        });

        expect(repository.listed).toEqual(["backend/schema"]);
        expect(repository.reads.sort()).toEqual(Object.keys(SCHEMA_FILES).map(name => `backend/schema/${name}`).sort());
        expect(files.map(file => file.path)).toEqual(["backend/schema/tags.ts"]);
        expect(files[0].contents).toContain("color: col.text()");
        expect(result.descriptors.find(d => d.slug === "tags")?.columns.map(c => c.key)).toEqual(["id", "label", "color"]);
    });

    it("adds a relation, importing the target's file it fetched", async () => {
        const { files } = await previewRemoteSchema({
            repository: repositoryWith(project()),
            schemaPath: "backend/schema",
            preview: realEditor([{ op: "addRelation", table: "posts", name: "tags", relation: { kind: "manyToMany", target: "tags" } }])
        });
        expect(files.map(file => file.path)).toEqual(["backend/schema/posts.ts"]);
        expect(files[0].contents).toContain("import { tags } from \"./tags\";");
    });

    it("deletes a table, taking it out of the index in the same change", async () => {
        const { files } = await previewRemoteSchema({
            repository: repositoryWith(project()),
            schemaPath: "backend/schema",
            preview: realEditor([{ op: "deleteTable", table: "tags" }])
        });
        const byPath = Object.fromEntries(files.map(file => [file.path, file]));
        expect(Object.keys(byPath)).toEqual(["backend/schema/index.ts", "backend/schema/tags.ts"]);
        expect(byPath["backend/schema/tags.ts"]).toMatchObject({ contents: "", deleted: true });
        expect(byPath["backend/schema/index.ts"].contents).not.toContain("tags");
    });

    it("respects a project in a subdirectory, and a trailing slash", async () => {
        const repository = repositoryWith(project("app/backend/schema"));
        const { files } = await previewRemoteSchema({
            repository,
            schemaPath: "app/backend/schema/",
            preview: realEditor([{ op: "setOption", table: "tags", option: "history", value: true }])
        });
        expect(repository.listed).toEqual(["app/backend/schema"]);
        expect(files.map(file => file.path)).toEqual(["app/backend/schema/tags.ts"]);
    });

    it("leaves no scratch directory behind, even when the edit is refused", async () => {
        const count = () => fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("rebase-remote-schema-")).length;
        const before = count();
        await expect(previewRemoteSchema({
            repository: repositoryWith(project()),
            schemaPath: "backend/schema",
            preview: realEditor([{ op: "removeColumn", table: "tags", key: "id" }])
        })).rejects.toThrow(/was not written/);
        expect(count()).toBe(before);
    });

    it("refuses a repository that cannot list and read, rather than editing from part of the schema", async () => {
        const repository = repositoryWith(project());
        const partial: SchemaEditRepository = { ...repository, listFiles: undefined };
        await expect(previewRemoteSchema({
            repository: partial,
            schemaPath: "backend/schema",
            preview: realEditor([{ op: "deleteTable", table: "tags" }])
        })).rejects.toThrow(/cannot list a directory/);
    });

    it("never writes a listed path outside the scratch directory", async () => {
        const repository = repositoryWith({ "backend/schema/../../escape.ts": "export const x = 1;\n" });
        await expect(previewRemoteSchema({
            repository,
            schemaPath: "backend/schema",
            preview: async () => ({ files: [], result: undefined })
        })).rejects.toThrow(/outside/);
    });
});
