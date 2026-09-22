import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import type { StorageController } from "../src/storage/types";
import { folderKey, listingPrefix, InvalidListOptionsError } from "../src/storage/keys";

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

/**
 * `maxResults` and `pageToken` went from the query string to the controller
 * unchecked. `maxResults=0` (or `-1`, or `abc`) made the local controller
 * answer an empty page whose `nextPageToken` was `"0"` — the token it had just
 * been given — so a `while (pageToken)` loop never ended; `pageToken=-1` read
 * `entries[-1]` and answered 500; on S3 a negative `MaxKeys` reached the SDK.
 */
describe("GET /list refuses paging it cannot honour", () => {
    let tempDir: string;
    let app: Hono<HonoEnv>;

    const list = (query: string) => app.request(`/api/storage/list?path=paged${query}`);

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-list-paging-"));
        const controller = new LocalStorageController({ basePath: tempDir });
        for (const name of ["a.txt", "b.txt", "c.txt"]) {
            await controller.putObject({ file: new File(["x"], name, { type: "text/plain" }), key: `paged/${name}` });
        }
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false }));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it.each(["0", "-1", "abc", "1.5", ""])("refuses maxResults=%p with 400", async (maxResults) => {
        const res = await list(`&maxResults=${maxResults}`);

        if (maxResults === "") {
            // An empty parameter is an absent one, as for every other query field.
            expect(res.status).toBe(200);
            return;
        }
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_LIST_OPTIONS" } });
    });

    it.each(["-1", "abc", "1e3"])("refuses a local pageToken=%p it never issued with 400", async (pageToken) => {
        const res = await list(`&pageToken=${pageToken}`);

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_LIST_OPTIONS" } });
    });

    it("pages through with the tokens it does issue", async () => {
        const names: string[] = [];
        let pageToken: string | undefined;
        let pages = 0;
        do {
            const res = await list(`&maxResults=1${pageToken ? `&pageToken=${pageToken}` : ""}`);
            expect(res.status).toBe(200);
            const { data } = await res.json() as { data: { items: { name: string }[]; nextPageToken?: string } };
            names.push(...data.items.map(i => i.name));
            pageToken = data.nextPageToken;
            if (++pages > 20) throw new Error("listing did not terminate");
        } while (pageToken);

        expect(names.sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("refuses a bad maxResults before an object store is asked", async () => {
        // S3 took a negative `MaxKeys` to the provider, whose refusal came back
        // as a 500. The route is the only place that can refuse it for every
        // controller.
        const listObjects = jest.fn(async () => ({ items: [], prefixes: [] }));
        const remote = { getType: () => "s3", listObjects } as unknown as StorageController;
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller: remote, requireAuth: false }));

        const res = await list("&maxResults=-1");

        expect(res.status).toBe(400);
        expect(listObjects).not.toHaveBeenCalled();
    });

    it("the controller refuses a token it never issued rather than crashing on it", async () => {
        const controller = new LocalStorageController({ basePath: tempDir });

        await expect(controller.listObjects("paged", { pageToken: "-1" })).rejects.toBeInstanceOf(InvalidListOptionsError);
    });
});
