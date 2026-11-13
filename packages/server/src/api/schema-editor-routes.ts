import { Hono } from "hono";
import path from "node:path";
import { TablePatchError, parseTablePatches, type DatabaseAdmin, type TablePatch, type UnmappedTable } from "@rebasepro/types";
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
 * - `GET /unmapped-tables` — the database's tables no declared table maps
 *   ("Import an existing table"): `{ tables: [{ schema, table, rlsEnabled,
 *   policies, unimportable? }] }`.
 * - `GET /unmapped-tables/:schema/:table` — one of them as introspection
 *   describes it, `{ table: { …, descriptor, rlsRaised?, notes } }`: the
 *   `TableDescriptor` an `adoptTable` edit writes as its source. Its `rls` is
 *   never weaker than what the database enforces — with row-level security
 *   off or no policy it is `"admin-only"`, and `rlsRaised` says so.
 *
 * Every refusal says what to do, with the problems in `details.problems`: a
 * 400 for an edit the editor will not make (`SCHEMA_EDIT_REFUSED`), one whose
 * result does not compile (`SCHEMA_EDIT_DOES_NOT_COMPILE`) or a list of edits
 * that is not well formed (`INVALID_INPUT`), and a 409 when a file the edit
 * rewrites changed on disk since it was read (`SCHEMA_EDIT_STALE_FILE`).
 * Nothing is written on any of them.
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

/** The editor's refusal, as the answer that carries its reason and its problems: 409 for a stale file, 400 otherwise. */
function refusalsAsBadRequest<T>(run: () => Promise<T>): Promise<T> {
    return run().catch((error: unknown) => {
        if (error instanceof TableSourceEditError) {
            throw new ApiError(error.code === "SCHEMA_EDIT_STALE_FILE" ? 409 : 400, error.code, error.message, { problems: error.problems });
        }
        throw error;
    });
}

/** What the schema editor's routes read besides the editor. */
export interface SchemaEditorRoutesOptions {
    /** The default database's admin, read at request time: what describes the tables "Import an existing table" offers. */
    getAdmin?: () => DatabaseAdmin | undefined;
}

/** A table as the import list shows it: everything but its description. */
function summaryOf(table: UnmappedTable): Omit<UnmappedTable, "descriptor" | "notes" | "rlsRaised"> {
    return {
        schema: table.schema,
        table: table.table,
        rlsEnabled: table.rlsEnabled,
        policies: table.policies,
        ...(table.unimportable ? { unimportable: table.unimportable } : {})
    };
}

/**
 * The tables of the database no table of `backend/schema` maps, described,
 * with each `belongsTo` naming its target by the declared table's slug.
 */
async function unmappedTables(editor: TableSourceEditor, admin: DatabaseAdmin | undefined, onlySchema?: string): Promise<UnmappedTable[]> {
    const describe = admin?.describeUnmappedTables;
    if (!describe) {
        throw new ApiError(503, "SCHEMA_EDITING_UNSUPPORTED", "This database driver cannot describe its tables, so none can be imported from here.");
    }
    const declared = (await refusalsAsBadRequest(() => editor.compileCurrent())).descriptors;
    const schemas = onlySchema !== undefined ? [onlySchema] : [...new Set(["public", ...declared.map(descriptor => descriptor.schema)])];
    const out: UnmappedTable[] = [];
    for (const schema of schemas) {
        const inSchema = declared.filter(descriptor => descriptor.schema === schema);
        const slugOf = new Map(inSchema.map(descriptor => [descriptor.table, descriptor.slug]));
        for (const table of await describe.call(admin, schema, new Set(inSchema.map(descriptor => descriptor.table)))) {
            if (!table.descriptor) {
                out.push(table);
                continue;
            }
            const self = table.descriptor;
            const relations = self.relations.map(relation => ({
                ...relation,
                target: relation.target === self.table ? self.slug : slugOf.get(relation.target) ?? relation.target
            }));
            out.push({ ...table, descriptor: { ...self, relations } });
        }
    }
    return out;
}

/** The source-only schema editor's routes, over one editor. */
export function createSchemaEditorRoutes(editor: TableSourceEditor, options: SchemaEditorRoutesOptions = {}): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    router.get("/unmapped-tables", async (c) => {
        const tables = await unmappedTables(editor, options.getAdmin?.());
        return c.json({ tables: tables.map(summaryOf) });
    });

    router.get("/unmapped-tables/:schema/:table", async (c) => {
        const schema = c.req.param("schema");
        const name = c.req.param("table");
        const found = (await unmappedTables(editor, options.getAdmin?.(), schema)).find(table => table.table === name);
        if (!found) {
            throw ApiError.notFound(`The database has no table "${schema}"."${name}" that backend/schema does not declare already.`, "NOT_FOUND");
        }
        if (!found.descriptor) {
            throw ApiError.badRequest(`"${schema}"."${name}" cannot be imported: ${found.unimportable ?? "introspection could not describe it."}`, "SCHEMA_EDIT_REFUSED", {
                problems: [{ table: name, message: found.unimportable ?? "introspection could not describe it." }]
            });
        }
        return c.json({ table: found });
    });

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
