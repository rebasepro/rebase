import { Hono } from "hono";
import path from "node:path";
import {
    FrontendSourceEditError,
    FrontendSourceEditor,
    frontendSourceDirOf,
    parseFrontendSourceEdit,
    type FrontendSourceEdit
} from "../schema-edit/frontend-source-editor";
import { findProjectRoot } from "../schema-edit/project-root";
import { ApiError, errorHandler } from "./errors";
import { HonoEnv } from "./types";

/**
 * Editing the project's frontend source from the admin panel, in
 * development: `/api/admin/schema-editor/frontend/*`, mounted inside the
 * source-only schema editor, so behind the same gate (`schema:read` to read,
 * `schema:write` to write) and present exactly where that editor is — a
 * `schemaDir` on disk, `schemaEditor` not false, never under
 * `NODE_ENV=production` unless the server opted in.
 *
 * It edits the object argument of one call in `frontend/src` — the admin
 * panel uses it for the `defineFirestoreCollection({...})` calls of a hybrid
 * project — and knows nothing about what the call means:
 *
 * - `GET /calls?callee=<identifier>&key=<key>&list=<dotted path>…` — every
 *   call to `callee` picked out by its `key` member, with its file, version
 *   and what is edited in code.
 * - `POST /preview` `{ target, version?, operations }` — the file the edit
 *   would write; nothing is written.
 * - `POST /apply` — the same, written.
 *
 * Refusals are 400s with the problems in `details.problems`, in the codes the
 * table routes use: `SCHEMA_EDIT_REFUSED`, `SCHEMA_EDIT_DOES_NOT_COMPILE`,
 * `INVALID_INPUT`.
 */

/** The process's frontend source editor for the project `schemaDir` belongs to. */
export function createFrontendSourceEditor(schemaDir: string): FrontendSourceEditor {
    const root = findProjectRoot(schemaDir) ?? path.dirname(path.dirname(path.resolve(schemaDir)));
    return new FrontendSourceEditor(frontendSourceDirOf(root), { root });
}

function refusalsAsBadRequest<T>(run: () => Promise<T>): Promise<T> {
    return run().catch((error: unknown) => {
        if (error instanceof FrontendSourceEditError) throw ApiError.badRequest(error.message, error.code, { problems: error.problems });
        throw error;
    });
}

async function requestOf(c: { req: { json: () => Promise<unknown> } }) {
    const body: unknown = await c.req.json().catch(() => undefined);
    try {
        return parseFrontendSourceEdit(body);
    } catch (error) {
        if (error instanceof FrontendSourceEditError) throw ApiError.badRequest(error.message, error.code, { problems: error.problems });
        throw error;
    }
}

function describeEdit(editor: FrontendSourceEditor, edit: FrontendSourceEdit) {
    return { files: edit.files.map(file => ({ path: editor.relative(file.path), contents: file.contents })) };
}

/** The frontend source editor's routes, over one editor. */
export function createFrontendSourceRoutes(editor: FrontendSourceEditor): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    router.get("/calls", async (c) => {
        const callee = c.req.query("callee");
        const key = c.req.query("key");
        if (!callee || !key) throw ApiError.badRequest("Expected `?callee=<identifier>&key=<key>`.", "INVALID_INPUT");
        const lists = (c.req.queries("list") ?? []).filter(list => list.length > 0).map(list => list.split("."));
        const calls = await refusalsAsBadRequest(async () => editor.describe(callee, key, lists));
        return c.json({ calls });
    });

    router.post("/preview", async (c) => {
        const request = await requestOf(c);
        const edit = await refusalsAsBadRequest(() => editor.run(() => editor.preview(request)));
        return c.json(describeEdit(editor, edit));
    });

    router.post("/apply", async (c) => {
        const request = await requestOf(c);
        const edit = await refusalsAsBadRequest(() => editor.apply(request));
        return c.json({ success: true, ...describeEdit(editor, edit) });
    });

    return router;
}
