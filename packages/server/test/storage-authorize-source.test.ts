import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * The authorize hook is told the storage source the request is served from.
 *
 * A source has several spellings: `?storageId=private`, `?storageId=%20private`
 * and `?storageId=private%09` all reach the `private` controller, because the
 * registry canonicalizes the id (`canonicalStorageId` trims it), and the
 * default source is reached with the parameter absent, empty, blank or the
 * literal `(default)`. The hook was handed the id as the caller spelled it. So a
 * hook that guards one source by name — `storageId === "private"` — approved
 * `" private"` and the controller served `private`: the decision was about one
 * string and the read about another.
 *
 * It is now handed the canonical source, and nothing for the default one — what
 * its contract (`StorageAuthorizeContext.storageId`, "when one was given") and
 * the SDK, which omits the parameter for the default source, always implied.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { DefaultStorageRegistry } from "../src/storage/storage-registry";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";
import type { StorageAuthorizeContext } from "../src/storage/types";

describe("the authorize hook is told the source it is served from", () => {
    let app: Hono<HonoEnv>;
    let defaultDir: string;
    let privateDir: string;
    let seen: (string | undefined)[];

    /** Everything is allowed except the source named `private`. */
    const guardsPrivateByName = async (ctx: StorageAuthorizeContext) => {
        seen.push(ctx.storageId);
        return ctx.storageId !== "private";
    };

    const meta = (pairs: Record<string, string>): string =>
        Object.entries(pairs)
            .map(([k, v]) => `${k} ${Buffer.from(v, "utf-8").toString("base64")}`)
            .join(",");

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        seen = [];
        defaultDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-authz-source-default-"));
        privateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-authz-source-private-"));
        const defaultCtrl = new LocalStorageController({ type: "local", basePath: defaultDir });
        const privateCtrl = new LocalStorageController({ type: "local", basePath: privateDir });
        for (const [ctrl, body] of [[defaultCtrl, "default bytes"], [privateCtrl, "PRIVATE BYTES"]] as const) {
            await ctrl.putObject({
                file: new File([Buffer.from(body)], "doc.txt", { type: "text/plain" }),
                key: "doc.txt"
            });
        }

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            registry: DefaultStorageRegistry.create({ "(default)": defaultCtrl, private: privateCtrl }),
            requireAuth: false,
            authorize: guardsPrivateByName
        }));
    });

    afterEach(async () => {
        await fs.promises.rm(defaultDir, { recursive: true, force: true });
        await fs.promises.rm(privateDir, { recursive: true, force: true });
    });

    const PRIVATE_SPELLINGS = ["private", "%20private", "private%20", "%09private%0A"];

    it("refuses a read of the guarded source however its name is spelled", async () => {
        for (const spelling of PRIVATE_SPELLINGS) {
            seen = [];
            const meta = await app.fetch(new Request(`http://localhost/api/storage/metadata/doc.txt?storageId=${spelling}`));
            expect({ spelling, status: meta.status }).toEqual({ spelling, status: 403 });
            expect((await meta.json() as { data?: { token?: string } }).data?.token).toBeUndefined();

            const file = await app.fetch(new Request(`http://localhost/api/storage/file/doc.txt?storageId=${spelling}`));
            expect({ spelling, status: file.status }).toEqual({ spelling, status: 403 });
            expect(await file.text()).not.toContain("PRIVATE BYTES");

            expect(seen).toEqual(["private", "private"]);
        }
    });

    it("refuses a delete, a listing and an upload there the same way", async () => {
        for (const spelling of PRIVATE_SPELLINGS.slice(1)) {
            const del = await app.fetch(new Request(
                `http://localhost/api/storage/file/doc.txt?storageId=${spelling}`, { method: "DELETE" }
            ));
            expect({ spelling, status: del.status }).toEqual({ spelling, status: 403 });

            const list = await app.fetch(new Request(`http://localhost/api/storage/list?prefix=&storageId=${spelling}`));
            expect({ spelling, status: list.status }).toEqual({ spelling, status: 403 });

            const form = new FormData();
            form.append("file", new File([Buffer.from("overwritten")], "doc.txt", { type: "text/plain" }));
            form.append("key", "doc.txt");
            form.append("storageId", decodeURIComponent(spelling));
            const upload = await app.fetch(new Request("http://localhost/api/storage/upload", { method: "POST", body: form }));
            expect({ spelling, status: upload.status }).toEqual({ spelling, status: 403 });
        }
        expect(await fs.promises.readFile(path.join(privateDir, "default", "doc.txt"), "utf8")).toBe("PRIVATE BYTES");
    });

    it("refuses a resumable upload there the same way", async () => {
        const create = await app.fetch(new Request("http://localhost/api/storage/tus", {
            method: "POST",
            headers: {
                "Upload-Length": "5",
                "Upload-Metadata": meta({ key: "doc.txt", storageId: " private" })
            }
        }));
        expect(create.status).toBe(403);
        expect(seen).toEqual(["private"]);
    });

    it("names the default source no way at all, however it is spelled", async () => {
        for (const query of ["", "?storageId=", "?storageId=%20", "?storageId=(default)", "?storageId=%20(default)"]) {
            seen = [];
            const res = await app.fetch(new Request(`http://localhost/api/storage/metadata/doc.txt${query}`));
            expect({ query, status: res.status }).toEqual({ query, status: 200 });
            expect({ query, seen }).toEqual({ query, seen: [undefined] });
        }
    });
});
