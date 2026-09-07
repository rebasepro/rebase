import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { folderKey, listingPrefix } from "../src/storage/keys";

/**
 * A key a listing hands back has to be a key you can pass back.
 *
 * `listObjects("products/images/")` — the form the SDK docs' own example uses,
 * and the form `canonicalStorageKey` preserves, because a trailing slash is how
 * a prefix is spelled — built every returned key from the *raw* argument while
 * resolving the directory from the normalized one. So `putObject` returned
 * `products/images/a.txt` and the listing that followed said
 * `products/images//a.txt`. On disk that is the same file; on S3 it is a
 * different object.
 */
describe("listing keys are the keys that were written", () => {
    let controller: LocalStorageController;
    let tempDir: string;

    const upload = async (key: string) => {
        await controller.putObject({
            file: new File([Buffer.from("x")], path.basename(key), { type: "text/plain" }),
            key
        });
    };

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-listing-keys-"));
        controller = new LocalStorageController({ basePath: tempDir });
        await upload("products/images/a.txt");
        await upload("products/images/b.txt");
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("answers the same keys however the prefix is spelled", async () => {
        const spellings = ["products/images", "products/images/", "/products/images", "/products/images/"];
        const results = await Promise.all(
            spellings.map(async p => (await controller.listObjects(p)).items.map(i => i.fullPath).sort())
        );

        for (const keys of results) {
            expect(keys).toEqual(["products/images/a.txt", "products/images/b.txt"]);
        }
    });

    it("returns a folder as a key that can be listed again", async () => {
        const first = await controller.listObjects("products/");
        expect(first.prefixes.map(p => p.fullPath)).toEqual(["products/images"]);

        // The round trip: hand the folder straight back.
        const second = await controller.listObjects(first.prefixes[0].fullPath);
        expect(second.items.map(i => i.fullPath).sort())
            .toEqual(["products/images/a.txt", "products/images/b.txt"]);
    });

    it("names the object the same way `putObject` did", async () => {
        const written = await controller.putObject({
            file: new File([Buffer.from("x")], "c.txt", { type: "text/plain" }),
            key: "products/images/c.txt"
        });
        const listed = await controller.listObjects("products/images/");
        expect(listed.items.map(i => i.fullPath)).toContain(written.key);
    });

    it("`toString()` carries the same key", async () => {
        const listed = await controller.listObjects("products/images/");
        for (const item of listed.items) {
            expect(item.toString()).toBe(`local://default/${item.fullPath}`);
        }
    });
});

/**
 * The object stores answer the same question a different way, and used to
 * answer it differently.
 *
 * A delimiter listing keyed on `products/images` matches `products/images.txt`
 * and returns nothing from *inside* `products/images/`, so the same SDK call
 * behaved one way against local dev and another against the bucket in
 * production. `listingPrefix` is what both S3 and GCS now send.
 */
describe("listingPrefix / folderKey", () => {
    it("sends one spelling for every spelling of the same folder", () => {
        for (const p of ["products/images", "products/images/", "/products/images", "/products/images//"]) {
            expect(listingPrefix(p)).toBe("products/images/");
        }
    });

    it("sends no prefix at all for the root", () => {
        expect(listingPrefix("")).toBeUndefined();
        expect(listingPrefix("/")).toBeUndefined();
    });

    it("hands a folder back without the store's trailing slash", () => {
        expect(folderKey("products/images/")).toBe("products/images");
        expect(folderKey("products/images")).toBe("products/images");
        expect(folderKey("/products/")).toBe("products");
    });

    it("round-trips: a folder key sent back names the same folder", () => {
        expect(listingPrefix(folderKey("products/images/"))).toBe("products/images/");
    });
});
