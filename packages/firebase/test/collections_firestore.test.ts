import { afterAll, describe, expect, it } from "@jest/globals";
import { deleteApp, initializeApp } from "firebase/app";
import { collection, disableNetwork, doc, getDocsFromCache, getFirestore, setDoc, terminate } from "firebase/firestore";
import { COLLECTION_PATH_SEPARATOR } from "@rebasepro/common";
import { getDeclaredSubcollections } from "@rebasepro/types";
import { docsToCollectionTree } from "../src/utils/collections_firestore";

const app = initializeApp({
    projectId: "demo-collections-tree",
    apiKey: "offline",
    appId: "offline"
}, "collections-tree-test");
const firestore = getFirestore(app);

afterAll(() => terminate(firestore).then(() => deleteApp(app)));

/**
 * Real snapshots of stored collection configs. The client is offline, so each
 * write lands in the local cache and is read back from there.
 */
async function storedConfigs(path: string, ids: string[]) {
    await disableNetwork(firestore);
    for (const id of ids) {
        const slug = id.split(COLLECTION_PATH_SEPARATOR).pop();
        setDoc(doc(firestore, path, id), { slug, name: slug, properties: {} }).catch(() => undefined);
    }
    return (await getDocsFromCache(collection(firestore, path))).docs;
}

describe("docsToCollectionTree", () => {

    it("nests a subcollection under its parent", async () => {
        const docs = await storedConfigs("tree_one_child", [
            "authors",
            ["authors", "posts"].join(COLLECTION_PATH_SEPARATOR)
        ]);

        const tree = docsToCollectionTree(docs);

        expect(tree.map((c) => c.slug)).toEqual(["authors"]);
        // The thunk read the parent's `subcollections` when it was called —
        // by then itself — so it recursed until the stack ran out.
        expect(getDeclaredSubcollections(tree[0])?.().map((c) => c.slug)).toEqual(["posts"]);
    });

    it("keeps every sibling under the same parent", async () => {
        const docs = await storedConfigs("tree_siblings", [
            "authors",
            ["authors", "posts"].join(COLLECTION_PATH_SEPARATOR),
            ["authors", "awards"].join(COLLECTION_PATH_SEPARATOR)
        ]);

        const [authors] = docsToCollectionTree(docs);

        expect(getDeclaredSubcollections(authors)?.().map((c) => c.slug).sort()).toEqual(["awards", "posts"]);
    });

    it("nests two levels deep", async () => {
        const docs = await storedConfigs("tree_deep", [
            "authors",
            ["authors", "posts"].join(COLLECTION_PATH_SEPARATOR),
            ["authors", "posts", "comments"].join(COLLECTION_PATH_SEPARATOR)
        ]);

        const [authors] = docsToCollectionTree(docs);
        const [posts] = getDeclaredSubcollections(authors)?.() ?? [];
        if (!posts) throw new Error("authors has no subcollection");

        expect(posts.slug).toBe("posts");
        expect(getDeclaredSubcollections(posts)?.().map((c) => c.slug)).toEqual(["comments"]);
    });

});
