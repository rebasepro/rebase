import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * Byte-range requests.
 *
 * Not a performance nicety: without `Accept-Ranges` a browser will not offer to
 * seek in a media element served from here, and Safari refuses to play a
 * `<video>` whose first response is not a `206`. So this is the difference
 * between a player that works and one that does not.
 *
 * The parser is deliberately conservative. Anything malformed, multi-range, or
 * in a unit other than bytes resolves to "serve the whole object" — a range
 * request answered with `200` is always legal, while a range answered *wrongly*
 * is a corrupted download that nothing detects.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";
import { parseRange, contentRange, unsatisfiableContentRange } from "../src/storage/range";

describe("parseRange", () => {
    it("reads a closed range", () => {
        expect(parseRange("bytes=0-499", 1000)).toEqual({
            kind: "range", range: { start: 0, end: 499, length: 500 }
        });
    });

    it("reads an open-ended range as running to the last byte", () => {
        expect(parseRange("bytes=500-", 1000)).toEqual({
            kind: "range", range: { start: 500, end: 999, length: 500 }
        });
    });

    it("reads a suffix range as the LAST n bytes, not the first n", () => {
        expect(parseRange("bytes=-300", 1000)).toEqual({
            kind: "range", range: { start: 700, end: 999, length: 300 }
        });
    });

    it("clamps a suffix longer than the object to the whole object", () => {
        expect(parseRange("bytes=-5000", 1000)).toEqual({
            kind: "range", range: { start: 0, end: 999, length: 1000 }
        });
    });

    it("clamps an end past the object rather than refusing it", () => {
        expect(parseRange("bytes=900-5000", 1000)).toEqual({
            kind: "range", range: { start: 900, end: 999, length: 100 }
        });
    });

    it("serves a single byte", () => {
        expect(parseRange("bytes=7-7", 1000)).toEqual({
            kind: "range", range: { start: 7, end: 7, length: 1 }
        });
    });

    it("is case-insensitive about the unit and tolerant of whitespace", () => {
        expect(parseRange("  BYTES=0-9  ", 1000)).toMatchObject({ kind: "range" });
    });

    describe("unsatisfiable", () => {
        it("a start at or past the end", () => {
            expect(parseRange("bytes=1000-", 1000)).toEqual({ kind: "unsatisfiable" });
            expect(parseRange("bytes=1500-1600", 1000)).toEqual({ kind: "unsatisfiable" });
        });

        it("an inverted range", () => {
            expect(parseRange("bytes=500-100", 1000)).toEqual({ kind: "unsatisfiable" });
        });

        it("a zero-length suffix, which names no bytes", () => {
            expect(parseRange("bytes=-0", 1000)).toEqual({ kind: "unsatisfiable" });
        });

        it("any range at all against an empty object", () => {
            expect(parseRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
        });
    });

    describe("declined — served as a whole 200 instead", () => {
        it.each([
            ["no header", undefined],
            ["another unit", "items=0-10"],
            ["multiple ranges", "bytes=0-99,200-299"],
            ["no digits at all", "bytes=-"],
            ["not a range", "bytes=abc"],
            ["garbage", "banana"],
            ["empty", ""]
        ])("%s", (_label, header) => {
            expect(parseRange(header as string | undefined, 1000)).toEqual({ kind: "none" });
        });
    });

    it("formats Content-Range for a served range and for a 416", () => {
        expect(contentRange({ start: 0, end: 499, length: 500 }, 1000)).toBe("bytes 0-499/1000");
        expect(unsatisfiableContentRange(1000)).toBe("bytes */1000");
    });
});

describe("GET /file/* — ranges over the wire", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;
    const BODY = "0123456789abcdefghijklmnopqrstuvwxyz";

    const get = (headers: Record<string, string> = {}) =>
        app.fetch(new Request("http://localhost/api/storage/file/media/clip.bin", { headers }));

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-range-"));
        controller = new LocalStorageController({ basePath: tempDir });
        await controller.putObject({
            file: new File([Buffer.from(BODY)], "clip.bin", { type: "application/octet-stream" }),
            key: "media/clip.bin"
        });
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false }));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("advertises Accept-Ranges even without a Range header", async () => {
        const res = await get();
        expect(res.status).toBe(200);
        expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    });

    it("serves exactly the requested bytes with a 206", async () => {
        const res = await get({ Range: "bytes=0-9" });

        expect(res.status).toBe(206);
        expect(await res.text()).toBe("0123456789");
        expect(res.headers.get("Content-Range")).toBe(`bytes 0-9/${BODY.length}`);
        expect(res.headers.get("Content-Length")).toBe("10");
    });

    it("serves the middle of the object, not a prefix of it", async () => {
        const res = await get({ Range: "bytes=10-14" });
        expect(res.status).toBe(206);
        expect(await res.text()).toBe("abcde");
    });

    it("serves an open-ended range to the end", async () => {
        const res = await get({ Range: "bytes=30-" });
        expect(res.status).toBe(206);
        expect(await res.text()).toBe(BODY.slice(30));
    });

    it("serves a suffix range from the end", async () => {
        const res = await get({ Range: "bytes=-6" });
        expect(res.status).toBe(206);
        expect(await res.text()).toBe(BODY.slice(-6));
    });

    it("answers 416 with the object's size when the range cannot be satisfied", async () => {
        const res = await get({ Range: `bytes=${BODY.length + 10}-` });

        expect(res.status).toBe(416);
        expect(res.headers.get("Content-Range")).toBe(`bytes */${BODY.length}`);
        expect(await res.text()).toBe("");
    });

    it("serves the whole object for a range it declines to honour", async () => {
        const res = await get({ Range: "bytes=0-9,20-29" });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(BODY);
    });

    it("lets the conditional check win over the range, as RFC 9110 orders it", async () => {
        const etag = (await get()).headers.get("ETag")!;
        const res = await get({ "If-None-Match": etag, Range: "bytes=0-9" });

        expect(res.status).toBe(304);
        expect(await res.text()).toBe("");
        // Still advertised, so a client that revalidates knows it may seek.
        expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    });

    it("keeps the caching headers on a partial response", async () => {
        const res = await get({ Range: "bytes=0-4" });
        expect(res.headers.get("ETag")).toBeTruthy();
        expect(res.headers.get("Cache-Control")).toContain("private");
    });
});
