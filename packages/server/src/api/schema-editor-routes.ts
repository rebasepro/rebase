import { Hono } from "hono";
import { z } from "zod";
import { AstSchemaEditor } from "./ast-schema-editor";
import { ApiError, errorHandler } from "./errors";
import { HonoEnv } from "./types";

/**
 * Rewriting collection source from the admin panel.
 *
 * Every refusal in `AstSchemaEditor` is written for the person who will read it
 * — "Collection X has no file at …", "Relation Y has no target collection. Pick
 * one before saving." — and every one of them was a plain `Error`, which
 * `errorHandler` treats as an unexpected failure: 500, and a body that says
 * "Internal Server Error". The messages never left the server. They are 400s
 * now, so the panel can show what it was told.
 */
function refusalsAsBadRequest<T>(run: () => Promise<T>): Promise<T> {
    return run().catch((error: unknown) => {
        if (error instanceof ApiError) throw error;
        throw ApiError.badRequest(
            error instanceof Error ? error.message : String(error),
            "SCHEMA_EDIT_REFUSED"
        );
    });
}

/** The identifier half of every payload here, checked once. */
const collectionIdSchema = z.string().min(1, "`collectionId` is required");
const propertyKeySchema = z.string().min(1, "`propertyKey` is required");

const propertySaveSchema = z.object({
    collectionId: collectionIdSchema,
    propertyKey: propertyKeySchema,
    propertyConfig: z.record(z.string(), z.unknown())
});
const propertyDeleteSchema = z.object({
    collectionId: collectionIdSchema,
    propertyKey: propertyKeySchema
});
const collectionSaveSchema = z.object({
    collectionId: collectionIdSchema,
    collectionData: z.record(z.string(), z.unknown()),
    partial: z.boolean().optional()
});
const collectionDeleteSchema = z.object({
    collectionId: collectionIdSchema
});

/** Parse a body against a schema, or 400 naming the field. */
async function body<S extends z.ZodType>(c: { req: { json: () => Promise<unknown> } }, schema: S): Promise<z.infer<S>> {
    const raw = await c.req.json().catch(() => undefined);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        throw ApiError.badRequest(
            parsed.error.issues.map(i => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
            "INVALID_INPUT"
        );
    }
    return parsed.data;
}

export function createSchemaEditorRoutes(collectionsDir: string): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    const editor = new AstSchemaEditor(collectionsDir);

    router.post("/property/save", async (c) => {
        const { collectionId, propertyKey, propertyConfig } = await body(c, propertySaveSchema);
        await refusalsAsBadRequest(() => editor.saveProperty(collectionId, propertyKey, propertyConfig));
        return c.json({ success: true });
    });

    router.post("/property/delete", async (c) => {
        const { collectionId, propertyKey } = await body(c, propertyDeleteSchema);
        await refusalsAsBadRequest(() => editor.deleteProperty(collectionId, propertyKey));
        return c.json({ success: true });
    });

    /**
     * `partial: true` means "this payload is what changed", not "this is the
     * collection". Without it a one-key patch — which is what adding a column
     * posts — is read as a whole-collection save and deletes everything it does
     * not mention, `securityRules` included. Absent, it defaults to a full save,
     * so an older panel keeps the behaviour it was written against.
     */
    router.post("/collection/save", async (c) => {
        const { collectionId, collectionData, partial } = await body(c, collectionSaveSchema);
        await refusalsAsBadRequest(() =>
            editor.saveCollection(collectionId, collectionData, { partial: partial === true }));
        return c.json({ success: true });
    });

    router.post("/collection/delete", async (c) => {
        const { collectionId } = await body(c, collectionDeleteSchema);
        await refusalsAsBadRequest(() => editor.deleteCollection(collectionId));
        return c.json({ success: true });
    });

    return router;
}
