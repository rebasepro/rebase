import { Hono } from "hono";
import path from "node:path";
import { TablePatchError, parseTablePatches, type TablePatch } from "@rebasepro/types";
import { TableSourceEditError, TableSourceEditor, type TableSourceEdit } from "./table-source-editor";
import { ApiError, errorHandler } from "./errors";
import { createFrontendSourceEditor, createFrontendSourceRoutes } from "./frontend-source-routes";
import { HonoEnv } from "./types";

/**
 * Editing `backend/schema` from the Studio, on this machine, without touching
 * the database: `/api/admin/schema-editor/*`.
 *
 * - `GET /tables` — every table the index exports as the editor reads it,
 *   with what is edited in code (read-only) and why.
 * - `POST /preview` `{ patches }` — the files the edit would write, compiled;
 *   nothing is written.
 * - `POST /apply` `{ patches }` — the same, written to disk.
 *
 * Every refusal is a 400 whose message says what to do, with the problems in
 * `details.problems`: an edit the editor will not make
 * (`SCHEMA_EDIT_REFUSED`), one whose result does not compile
 * (`SCHEMA_EDIT_DOES_NOT_COMPILE`), or a list of edits that is not well formed
 * (`INVALID_INPUT`). Nothing is written on any of them.
 *
 * Changing the database is live schema editing's job (`/api/admin/schema`),
 * which commits the same edits and runs the DDL.
 *
 * `/frontend/*` edits the project's frontend source the same way — the
 * object argument of one call in `frontend/src`, which the admin panel uses
 * for its Firestore collections — under the same gate
 * (see `frontend-source-routes.ts`).
 */

/** The process's one editor of `schemaDir`, shared with live schema editing. */
export function createTableSourceEditor(schemaDir: string): TableSourceEditor {
    return new TableSourceEditor(schemaDir);
}

/** The `{ patches }` of a request, or a 400 naming every problem. */
async function patchesOf(c: { req: { json: () => Promise<unknown> } }): Promise<TablePatch[]> {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (typeof body !== "object" || body === null || !("patches" in body)) {
        throw ApiError.badRequest("Expected `{ patches: [...] }`: the schema edits to make.", "INVALID_INPUT");
    }
    try {
        return parseTablePatches(body.patches);
    } catch (error) {
        if (error instanceof TablePatchError) throw ApiError.badRequest(error.message, "INVALID_INPUT", { problems: error.problems });
        throw error;
    }
}

/** An edit, as the panel reads it: each file by its path in the project, with its new text. */
function describeEdit(editor: TableSourceEditor, edit: TableSourceEdit) {
    const root = path.dirname(path.dirname(editor.schemaDir));
    return {
        files: edit.files.map(file => ({
            path: path.relative(root, file.path).split(path.sep).join("/"),
            ...(file.deleted ? { deleted: true } : { contents: file.contents })
        })),
        tables: edit.schema.descriptors.map(descriptor => descriptor.slug)
    };
}

/** The editor's refusal, as the 400 that carries its reason and its problems. */
function refusalsAsBadRequest<T>(run: () => Promise<T>): Promise<T> {
    return run().catch((error: unknown) => {
        if (error instanceof TableSourceEditError) throw ApiError.badRequest(error.message, error.code, { problems: error.problems });
        throw error;
    });
}

/** The source-only schema editor's routes, over one editor. */
export function createSchemaEditorRoutes(editor: TableSourceEditor): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    router.get("/tables", async (c) => c.json({ tables: await editor.describe() }));

    router.post("/preview", async (c) => {
        const patches = await patchesOf(c);
        const edit = await refusalsAsBadRequest(() => editor.run(() => editor.preview(patches)));
        return c.json(describeEdit(editor, edit));
    });

    router.post("/apply", async (c) => {
        const patches = await patchesOf(c);
        const edit = await refusalsAsBadRequest(() => editor.apply(patches));
        return c.json({ success: true, ...describeEdit(editor, edit) });
    });

    router.route("/frontend", createFrontendSourceRoutes(createFrontendSourceEditor(editor.schemaDir)));

    return router;
}
