import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { generateSdkCommand } from "./generate_sdk";
import { serializeCollections, type CollectionConfig } from "@rebasepro/types";

/**
 * The `--from` path had no tests at all: the sibling suite mocks
 * `@rebasepro/codegen` wholesale, so it covers the loader and nothing beyond it.
 * What was uncovered included `mayUseAmbientKey` — the guard that decides
 * whether `REBASE_SERVICE_KEY`, a full admin bypass, is attached to the URL the
 * caller passed.
 *
 * Nothing is mocked here except `fetch`, so these also exercise the real
 * generator, the real files that reach disk, and the schema stamp.
 */

const authors = {
    slug: "authors",
    name: "Authors",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string", validation: { required: true } }
    }
} as unknown as CollectionConfig;

const posts = {
    slug: "posts",
    name: "Posts",
    properties: {
        id: { type: "string", isId: "uuid" },
        title: { type: "string", validation: { required: true } },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } }
    }
} as unknown as CollectionConfig;

function contractResponse(schemaVersion = "sha-from-server") {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            schemaVersion,
            collections: serializeCollections([posts, authors]),
            collectionSlugs: ["authors", "posts"]
        })
    } as unknown as Response;
}

describe("generate-sdk --from", () => {
    let tmpDir: string;
    let fetchMock: ReturnType<typeof vi.fn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    const savedKey = process.env.REBASE_SERVICE_KEY;

    /** A directory `findProjectRoot` will stop at, optionally linked to a project. */
    function project(apiUrl?: string): string {
        fs.writeFileSync(path.join(tmpDir, "rebase.json"), JSON.stringify({ name: "t" }));
        if (apiUrl) {
            fs.mkdirSync(path.join(tmpDir, ".rebase"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, ".rebase", "cloud.json"), JSON.stringify({ apiUrl }));
        }
        return tmpDir;
    }

    const run = (from: string, extra: Record<string, unknown> = {}) => generateSdkCommand({
        collectionsDir: path.join(tmpDir, "collections"),
        output: path.join(tmpDir, "out"),
        cwd: tmpDir,
        from,
        ...extra
    });

    const headersOf = (call: number = 0) =>
        (fetchMock.mock.calls[call]?.[1] as { headers: Record<string, string> } | undefined)?.headers ?? {};

    beforeEach(() => {
        tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-sdk-from-")));
        fetchMock = vi.fn(async () => contractResponse());
        vi.stubGlobal("fetch", fetchMock);
        vi.spyOn(console, "log").mockImplementation(() => {});
        // `process.exit` is how this command reports failure. Throwing instead
        // keeps a test that expects a refusal from running on into the code the
        // refusal was supposed to prevent.
        exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`process.exit(${code})`);
        });
        delete process.env.REBASE_SERVICE_KEY;
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        exitSpy.mockRestore();
        if (savedKey === undefined) delete process.env.REBASE_SERVICE_KEY;
        else process.env.REBASE_SERVICE_KEY = savedKey;
    });

    describe("the ambient service key", () => {
        it("is sent to the linked project", async () => {
            process.env.REBASE_SERVICE_KEY = "svc-secret";
            project("https://api.acme.com");

            await run("https://api.acme.com");

            expect(headersOf().authorization).toBe("Bearer svc-secret");
        });

        it("is withheld from a host this checkout is not linked to", async () => {
            // The key is a full admin bypass. Attaching it to whatever URL was
            // passed would hand a project's most powerful credential to a host
            // nobody vetted.
            process.env.REBASE_SERVICE_KEY = "svc-secret";
            project("https://api.acme.com");

            await run("https://evil.example.com");

            expect(headersOf().authorization).toBeUndefined();
        });

        it("is withheld when the scheme is downgraded", async () => {
            // Same host, cleartext. Comparing hosts rather than origins would
            // have sent the key over http.
            process.env.REBASE_SERVICE_KEY = "svc-secret";
            project("https://api.acme.com");

            await run("http://api.acme.com");

            expect(headersOf().authorization).toBeUndefined();
        });

        it("is withheld when this checkout is not linked at all", async () => {
            process.env.REBASE_SERVICE_KEY = "svc-secret";
            project();

            await run("https://api.acme.com");

            expect(headersOf().authorization).toBeUndefined();
        });

        it("is overridden by an explicit --token, which is a decision the caller made", async () => {
            process.env.REBASE_SERVICE_KEY = "svc-secret";
            project();

            await run("https://anywhere.example.com", { token: "explicit" });

            expect(headersOf().authorization).toBe("Bearer explicit");
        });
    });

    describe("resolving --from", () => {
        it("follows the link file for `link`", async () => {
            project("https://api.acme.com");

            await run("link");

            expect(fetchMock.mock.calls[0][0]).toBe("https://api.acme.com/api/meta/contract");
        });

        it("refuses `link` when the checkout is not linked", async () => {
            project();
            await expect(run("link")).rejects.toThrow("process.exit(1)");
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("refuses a non-URL", async () => {
            project();
            await expect(run("api.acme.com")).rejects.toThrow("process.exit(1)");
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("refuses a non-http scheme", async () => {
            project();
            await expect(run("file:///etc/passwd")).rejects.toThrow("process.exit(1)");
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("strips trailing slashes rather than doubling them", async () => {
            project();
            await run("https://api.acme.com//");
            expect(fetchMock.mock.calls[0][0]).toBe("https://api.acme.com/api/meta/contract");
        });
    });

    describe("contract failures", () => {
        for (const [status, why] of [[401, "unauthorized"], [403, "forbidden"], [404, "no endpoint"], [500, "server error"]] as const) {
            it(`refuses on ${status} (${why})`, async () => {
                project();
                fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({}) } as unknown as Response);
                await expect(run("https://api.acme.com")).rejects.toThrow("process.exit(1)");
            });
        }

        it("refuses when the response carries no collections", async () => {
            project();
            fetchMock.mockResolvedValue({
                ok: true, status: 200, json: async () => ({ schemaVersion: "x" })
            } as unknown as Response);
            await expect(run("https://api.acme.com")).rejects.toThrow("process.exit(1)");
        });

        it("refuses when the host is unreachable", async () => {
            project();
            fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
            await expect(run("https://api.acme.com")).rejects.toThrow("process.exit(1)");
        });
    });

    it("refuses a schema that cannot produce a valid client, and writes nothing", async () => {
        // Two slugs collapsing onto one accessor. Emitting it would produce a
        // file that does not compile — and a `collectionsDictionary` keeping
        // only one of them, sending a collection's reads to the other's table.
        project();
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                schemaVersion: "x",
                collections: serializeCollections([
                    { slug: "my-notes", name: "A", properties: {} },
                    { slug: "my_notes", name: "B", properties: {} }
                ] as unknown as CollectionConfig[])
            })
        } as unknown as Response);

        await expect(run("https://api.acme.com")).rejects.toThrow("process.exit(1)");
        expect(fs.existsSync(path.join(tmpDir, "out", "database.types.ts"))).toBe(false);
    });

    describe("what reaches disk", () => {
        it("writes types built from the remote contract, keyed by the wire names", async () => {
            project();
            await run("https://api.acme.com");

            const types = fs.readFileSync(path.join(tmpDir, "out", "database.types.ts"), "utf-8");
            // The relation survives the serialize/deserialize round trip, so the
            // foreign key is typed from the target's own primary key rather than
            // degrading to `string | number`.
            //
            // `authorId`, not `author_id`: a generated Row is keyed by what the
            // API answers, and the API is camelCase throughout. The column is
            // still `author_id` — that is the point of the split, and it is why
            // this assertion is on the SDK rather than on the schema. This test
            // read `author_id` until the wire was unified, and asserting the
            // column name here is how a Row type comes to describe a key no
            // response carries.
            expect(types).toContain("authorId?: number | null;");
            expect(types).toContain('Database["authors"]["Row"]');
            expect(types).toContain('posts: "posts",');
        });

        it("stamps the schema version the server reported, not a recomputed one", async () => {
            project();
            fetchMock.mockResolvedValue(contractResponse("sha-the-server-said"));

            await run("https://api.acme.com");

            const meta = fs.readFileSync(path.join(tmpDir, "out", "schema.meta.ts"), "utf-8");
            expect(meta).toContain('export const SCHEMA_VERSION = "sha-the-server-said";');
        });

        it("produces byte-identical output when run twice on the same schema", async () => {
            // The command sorts collections precisely so a regeneration is not a
            // diff. A generation timestamp used to defeat that, and with it any
            // `generate-sdk && git diff --exit-code` staleness gate.
            project();
            await run("https://api.acme.com");
            const first = ["database.types.ts", "schema.meta.ts", "README.md"]
                .map(f => fs.readFileSync(path.join(tmpDir, "out", f), "utf-8"));

            await run("https://api.acme.com");
            const second = ["database.types.ts", "schema.meta.ts", "README.md"]
                .map(f => fs.readFileSync(path.join(tmpDir, "out", f), "utf-8"));

            expect(second).toEqual(first);
        });
    });
});
