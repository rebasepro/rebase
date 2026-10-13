import { describe, expect, it } from "@jest/globals";
import type { CollectionCallbacks, CollectionConfig, DataDriver, StorageSource, User } from "@rebasepro/types";
import { buildSdkData, createCallContext } from "../src";

/**
 * A collection callback is a plain function of one props object, so a test
 * calls it. `createCallContext` is what makes the `context` prop cheap to
 * supply: what the test cares about it passes, and anything else is a
 * stand-in that throws — naming the field — only if the hook actually uses it.
 */

const posts: CollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string" },
        authorName: { name: "Author", type: "string" }
    }
};

const editor: User = {
    uid: "u1",
    displayName: null,
    email: null,
    photoURL: null,
    providerId: "password",
    isAnonymous: false,
    roles: ["editor"]
};

/** A driver that knows one author, for the hook below to look up. */
function authorsDriver(): DataDriver {
    const unused = async (): Promise<never> => {
        throw new Error("not used by this test");
    };
    return {
        fetchCollection: unused,
        fetchOne: async ({ path, id }) => (path === "authors" && id === "u1" ? { id: "u1", name: "Ada" } : undefined),
        save: unused,
        delete: unused,
        checkUniqueField: unused
    };
}

/** Stamps the author's name, read through `context.data`, on a new post. */
const stampAuthor: CollectionCallbacks = {
    beforeSave: async ({ values, context }) => {
        const uid = context.user?.uid;
        if (!uid) throw new Error("Sign in to post.");
        const author = await context.data.authors.findById(uid);
        return { ...values, authorName: author?.name };
    }
};

describe("createCallContext", () => {
    it("runs a hook with the fields a test passes", async () => {
        const result = await stampAuthor.beforeSave!({
            collection: posts,
            path: "posts",
            status: "new",
            values: { title: "Hello" },
            context: createCallContext({ user: editor, data: buildSdkData(authorsDriver()) })
        });

        expect(result).toEqual({ title: "Hello", authorName: "Ada" });
    });

    it("leaves `user` absent when it is not passed, as a write with no caller sees it", async () => {
        const context = createCallContext();

        expect(context.user).toBeUndefined();
        expect("user" in context).toBe(false);
        expect(context.driver).toBeUndefined();
        await expect(stampAuthor.beforeSave!({
            collection: posts, path: "posts", status: "new", values: { title: "Hello" }, context
        })).rejects.toThrow("Sign in to post.");
    });

    it("uses what it is given as it is", () => {
        const data = buildSdkData(authorsDriver());
        const storageSource = createCallContext().storageSource;
        const driver = authorsDriver();
        const context = createCallContext({ data, storageSource, user: editor, driver });

        expect(context.data).toBe(data);
        expect(context.storageSource).toBe(storageSource);
        expect(context.user).toBe(editor);
        expect(context.driver).toBe(driver);
    });

    it("builds, and lets every missing field be read, without throwing", () => {
        const context = createCallContext();

        expect(() => context.client.functions).not.toThrow();
        expect(() => context.data.posts).not.toThrow();
        expect(() => context.data.collection("posts")).not.toThrow();
        expect(() => context.storageSource.putObject).not.toThrow();
    });

    it("throws on the first use of a missing `data`, naming the field", async () => {
        const context = createCallContext();

        await expect(context.data.posts.find()).rejects.toThrow(
            "context.data was not provided to createCallContext"
        );
        await expect(context.data.collection("posts").create({ title: "x" })).rejects.toThrow(
            "buildSdkData(driver)"
        );
        await expect(stampAuthor.beforeSave!({
            collection: posts, path: "posts", status: "new", values: { title: "Hello" },
            context: createCallContext({ user: editor })
        })).rejects.toThrow("context.data was not provided to createCallContext");
    });

    it("throws on the first use of a missing `storageSource`, naming the field", async () => {
        const upload: CollectionCallbacks = {
            afterSave: async ({ context }) => {
                await context.storageSource.putObject({ file: new File(["x"], "x.txt"), key: "x.txt" });
            }
        };

        await expect(upload.afterSave!({
            collection: posts, path: "posts", id: 1, status: "new", values: {}, context: createCallContext()
        })).rejects.toThrow("context.storageSource was not provided to createCallContext, and the callback used context.storageSource.putObject");
    });

    it("throws on the first use of a missing `client`, naming the member used", async () => {
        const context = createCallContext();

        expect(() => context.client.functions!.invoke("notify")).toThrow(
            "context.client was not provided to createCallContext, and the callback used context.client.functions.invoke"
        );
        expect(() => context.client.email!.send({ to: "a@example.com", subject: "s", html: "<p>t</p>" })).toThrow(
            "context.client.email.send"
        );
        expect(() => context.client.auth.getSession()).toThrow("context.client.auth.getSession");
        await expect(context.client.dataAsAdmin!.posts.find()).rejects.toThrow(
            "context.client was not provided to createCallContext, and the callback used context.client.dataAsAdmin"
        );
    });

    it("does not stand in for a field that was passed", async () => {
        const storageSource: StorageSource = {
            putObject: async ({ key }) => ({ key, bucket: "memory", storageUrl: `memory://${key}` }),
            getSignedUrl: async () => ({ url: null }),
            getObject: async () => null,
            deleteObject: async () => undefined,
            listObjects: async () => ({ prefixes: [], items: [] })
        };
        const context = createCallContext({ storageSource });

        await expect(context.storageSource.putObject({ file: new File(["x"], "x.txt"), key: "x.txt" }))
            .resolves.toMatchObject({ key: "x.txt", storageUrl: "memory://x.txt" });
    });
});
