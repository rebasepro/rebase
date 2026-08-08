import { Hono } from "hono";
import { AstSchemaEditor } from "./ast-schema-editor";
import { errorHandler } from "./errors";
import { HonoEnv } from "./types";

export function createSchemaEditorRoutes(collectionsDir: string): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    const editor = new AstSchemaEditor(collectionsDir);

    router.post("/property/save", async (c) => {
        const body = await c.req.json();
        const { collectionId, propertyKey, propertyConfig } = body;
        await editor.saveProperty(collectionId, propertyKey, propertyConfig);
        return c.json({ success: true });
    });

    router.post("/property/delete", async (c) => {
        const body = await c.req.json();
        const { collectionId, propertyKey } = body;
        await editor.deleteProperty(collectionId, propertyKey);
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
        const body = await c.req.json();
        const { collectionId, collectionData, partial } = body;
        await editor.saveCollection(collectionId, collectionData, { partial: partial === true });
        return c.json({ success: true });
    });

    router.post("/collection/delete", async (c) => {
        const body = await c.req.json();
        const { collectionId } = body;
        await editor.deleteCollection(collectionId);
        return c.json({ success: true });
    });

    return router;
}

