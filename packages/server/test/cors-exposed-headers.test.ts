import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { resolveCorsOptions, type RebaseBootEnv } from "../src/boot/env";

/**
 * Every response header the SDK reads is one a browser on another origin is
 * allowed to read.
 *
 * Outside the CORS-safelisted few (`Content-Type`, `Cache-Control`, …) a
 * cross-origin `fetch` sees a header only when `Access-Control-Expose-Headers`
 * names it. The runtime sent none, so in every cross-origin setup — and every
 * `rebase dev` project is one, a Vite frontend on its own port talking to the
 * backend's — `etagOf(row)` was always `undefined` and an `ifMatch` update went
 * out with no `If-Match`: a conditional write silently became an unconditional
 * one. `retryAfterSeconds` and `requestId` on a 429 were lost the same way.
 *
 * No SDK test could see it: they all hand the client a fake `fetch`, and a fake
 * `fetch` does not enforce CORS. So this reads the headers the client actually
 * reads, from its source, and asserts the server's CORS config exposes each one
 * — a header the SDK starts reading tomorrow fails here until it is exposed.
 */

const REPO = path.resolve(__dirname, "..", "..", "..");
const CLIENT_SRC = path.join(REPO, "packages", "client", "src");

/** `headers.get("X")`, `headers?.get("X")`, `headers?.get?.("X")`. */
const HEADER_READ = /headers\??\.get\??\.?\(\s*["'`]([A-Za-z0-9-]+)["'`]/g;

/**
 * Headers a cross-origin script can read without being exposed. Listed so the
 * guard does not demand exposing what needs no exposing.
 * https://fetch.spec.whatwg.org/#cors-safelisted-response-header-name
 */
const SAFELISTED = new Set([
    "cache-control", "content-language", "content-length", "content-type", "expires", "last-modified", "pragma"
]);

function headersTheClientReads(): string[] {
    const names = new Set<string>();
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
            for (const match of fs.readFileSync(full, "utf-8").matchAll(HEADER_READ)) {
                names.add(match[1].toLowerCase());
            }
        }
    };
    walk(CLIENT_SRC);
    return [...names].filter(name => !SAFELISTED.has(name)).sort();
}

describe("CORS exposes every response header the SDK reads", () => {
    const read = headersTheClientReads();

    it("finds the headers the client reads", () => {
        // A pattern that silently matched nothing would make every assertion
        // below vacuous. These three are read today, and losing any of them is
        // the bug this file exists for.
        expect(read).toEqual(expect.arrayContaining(["etag", "retry-after", "x-request-id"]));
    });

    it("the runtime's CORS config names each one", async () => {
        const app = new Hono();
        app.use("/*", cors(resolveCorsOptions({ NODE_ENV: "development" } as RebaseBootEnv)));
        app.get("/api/data/posts/1", (c) => c.json({ id: 1 }));

        const res = await app.request("/api/data/posts/1", { headers: { Origin: "http://localhost:5173" } });

        const exposed = (res.headers.get("access-control-expose-headers") ?? "")
            .split(",").map(name => name.trim().toLowerCase()).filter(Boolean);
        expect(exposed).toEqual(expect.arrayContaining(read));
    });

    it("the eject template's CORS config names each one", () => {
        // An ejected backend wires its own `cors()`; it is the same API, read
        // by the same SDK, from the same other origin.
        const source = fs.readFileSync(
            path.join(REPO, "packages", "cli", "templates", "eject", "backend", "src", "index.ts"),
            "utf-8"
        );
        const list = /exposeHeaders:\s*\[([^\]]*)\]/.exec(source)?.[1] ?? "";
        const exposed = [...list.matchAll(/["'`]([A-Za-z0-9-]+)["'`]/g)].map(m => m[1].toLowerCase());
        expect(exposed).toEqual(expect.arrayContaining(read));
    });
});
