/**
 * The project commands' own decisions, without a server: how a line becomes a
 * request (`rebase api`, `data`), how a file becomes rows (`data import`), how
 * the stored side of `storage cp` is told from the local one, and where a
 * request goes and with what credential (`utils/project-target.ts`).
 *
 * The end-to-end half — the same commands against a running `rebase dev` —
 * is `test/e2e/project-commands.test.ts`.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApiPlan, resolveApiPath, resolveApiRequest, typedFieldValue } from "./api";
import { orderByParam, parseCsv, readImportRows, whereParams, dataCommand } from "./data";
import { remoteObjectOf } from "./storage-objects";
import { olderThan } from "./users";
import { tableView } from "./schema-show";
import { tokenExpiry } from "./auth-session";
import { resolveProjectTarget, sessionTokensOf, saveSession, storedSession, forgetSession, TargetError } from "../utils/project-target";

const argv = (...words: string[]) => ["node", "rebase", ...words];

describe("rebase api", () => {
    it("puts a relative path under /api, and sends one starting with / as written", () => {
        expect(resolveApiPath("data/posts")).toBe("/api/data/posts");
        expect(resolveApiPath("/health")).toBe("/health");
    });

    it("refuses a URL: the target flags say where the credential goes", () => {
        expect(() => resolveApiPath("https://evil.example/api/data")).toThrow(/takes a path, not a URL/);
    });

    it("reads the method from the first word, and fields as query on GET, JSON body on POST", () => {
        const get = resolveApiRequest(argv("api", "data/posts", "-f", "status=eq.published", "-f", "limit=5")).plan;
        expect(get).toMatchObject({ method: "GET", path: "/api/data/posts", query: { status: ["eq.published"], limit: ["5"] } });
        expect(get.body).toBeUndefined();

        const post = resolveApiRequest(argv("api", "POST", "data/posts", "-F", "title=Hi", "-F", "published=true", "-F", "views=3")).plan;
        expect(post.method).toBe("POST");
        expect(JSON.parse(post.body ?? "{}")).toEqual({ title: "Hi", published: true, views: 3 });
    });

    it("stays a GET with fields alone: a write is named, or carries --input", () => {
        // `gh api` posts as soon as a field is added; here that would create a row.
        expect(resolveApiRequest(argv("api", "data/posts", "-f", "limit=5")).plan).toMatchObject({ method: "GET", query: { limit: ["5"] } });
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-api-input-")), "row.json");
        fs.writeFileSync(file, "{\"title\":\"Hi\"}");
        expect(resolveApiRequest(argv("api", "data/posts", "--input", file)).plan).toMatchObject({ method: "POST", contentType: "application/json" });
    });

    it("keeps a query string written into the path", () => {
        expect(resolveApiRequest(argv("api", "data/posts?limit=2")).plan.query).toEqual({ limit: ["2"] });
    });

    it("refuses an Authorization header — the target picks the credential", () => {
        expect(() => buildApiPlan({ path: "/api/x", headers: ["Authorization: Bearer x"] })).toThrow(/--token/);
    });

    it("reads typed fields as gh api -F does", () => {
        expect(typedFieldValue("null")).toBeNull();
        expect(typedFieldValue("12.5")).toBe(12.5);
        expect(typedFieldValue("[1,2]")).toEqual([1, 2]);
        expect(typedFieldValue("plain")).toBe("plain");
    });
});

describe("rebase data", () => {
    it("passes --where through in the API's own syntax; a bare value is equality", () => {
        expect(whereParams(["status=eq.published", "price=gte.10", "author=ada"]))
            .toEqual({ status: ["eq.published"], price: ["gte.10"], author: ["ada"] });
    });

    it("refuses a --where that names a query option rather than a column", () => {
        expect(() => whereParams(["limit=5"])).toThrow(/query option/);
        expect(() => whereParams(["nonsense"])).toThrow(/column=op.value/);
    });

    it("sends one --order-by as written and several as the API's JSON list", () => {
        expect(orderByParam(["created_at:desc"])).toBe("created_at:desc");
        expect(JSON.parse(orderByParam(["status", "created_at:desc"]) ?? "[]"))
            .toEqual([{ field: "status" }, { field: "created_at", direction: "desc" }]);
    });

    it("parses CSV with quotes, doubled quotes and newlines inside quotes", () => {
        expect(parseCsv("title,body\n\"Hello, world\",\"line one\nline \"\"two\"\"\"\nplain,x\n"))
            .toEqual([{ title: "Hello, world", body: "line one\nline \"two\"" }, { title: "plain", body: "x" }]);
    });

    it("reads NDJSON, a JSON array, and what `data query --format json` writes", () => {
        expect(readImportRows("{\"a\":1}\n\n{\"a\":2}\n", "ndjson")).toEqual([{ a: 1 }, { a: 2 }]);
        expect(readImportRows("[{\"a\":1}]", "json")).toEqual([{ a: 1 }]);
        expect(readImportRows("{\"data\":[{\"a\":1}],\"meta\":{}}", "json")).toEqual([{ a: 1 }]);
        expect(() => readImportRows("{\"a\":1}", "json")).toThrow(/array of row objects/);
    });
});

describe("rebase storage cp's two sides", () => {
    it("reads :key and source:key as stored objects, and a path as local", () => {
        expect(remoteObjectOf(":avatars/me.png")).toEqual({ source: "", key: "avatars/me.png" });
        expect(remoteObjectOf("media:avatars/me.png")).toEqual({ source: "media", key: "avatars/me.png" });
        expect(remoteObjectOf("./me.png")).toBeUndefined();
        expect(remoteObjectOf("C:\\Users\\me.png")).toBeUndefined();
    });
});

describe("rebase users guests --older-than", () => {
    it("reads hours, days and weeks", () => {
        const now = new Date("2026-11-15T12:00:00Z");
        expect(olderThan("12h", now).toISOString()).toBe("2026-11-15T00:00:00.000Z");
        expect(olderThan("2d", now).toISOString()).toBe("2026-11-13T12:00:00.000Z");
        expect(olderThan("1w", now).toISOString()).toBe("2026-11-08T12:00:00.000Z");
        expect(() => olderThan("soon", now)).toThrow(/30d/);
    });
});

describe("rebase schema show", () => {
    it("reads a descriptor into columns, relations and the RLS posture", () => {
        const view = tableView({
            slug: "posts",
            name: "posts",
            kind: "table",
            primaryKey: ["id"],
            columns: [{ key: "id", type: "uuid", nullable: false, primaryKey: true }, { key: "title", type: "text", nullable: true }],
            relations: [{ key: "author", kind: "belongsTo", target: "users" }],
            rls: { posture: "rules", rules: [{}, {}] }
        });
        expect(view.columns.map(column => [column.key, column.nullable, column.extra])).toEqual([["id", false, ["pk"]], ["title", true, []]]);
        expect(view.relations).toEqual([{ key: "author", kind: "belongsTo", target: "users" }]);
        expect(view.rls).toBe("rules, 2 rule(s)");
    });
});

describe("person sessions", () => {
    let file: string;
    beforeEach(() => {
        file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-sessions-")), "sessions.json");
        process.env.REBASE_SESSIONS_FILE = file;
    });
    afterEach(() => {
        delete process.env.REBASE_SESSIONS_FILE;
    });

    it("are kept per origin, privately, and forgotten on logout", () => {
        saveSession("http://localhost:3001/some/path", { accessToken: "a", refreshToken: "r", expiresAt: 1 });
        expect(storedSession("http://localhost:3001")?.accessToken).toBe("a");
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(forgetSession("http://localhost:3001")).toBe(true);
        expect(storedSession("http://localhost:3001")).toBeUndefined();
    });

    it("read the token pair out of an auth answer, and the expiry out of the JWT", () => {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const token = `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
        expect(tokenExpiry(token)).toBe(exp * 1000);
        expect(sessionTokensOf({ tokens: { accessToken: "a", refreshToken: "r", accessTokenExpiresAt: exp } }))
            .toEqual({ accessToken: "a", refreshToken: "r", expiresAt: exp * 1000 });
    });
});

describe("where a project command's request goes", () => {
    const saved = { cwd: process.cwd(), base: process.env.REBASE_BASE_URL, key: process.env.REBASE_SERVICE_KEY };
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-target-"));
        fs.writeFileSync(path.join(root, "rebase.json"), "{}");
        process.chdir(root);
        delete process.env.REBASE_BASE_URL;
        delete process.env.REBASE_SERVICE_KEY;
    });
    afterEach(() => {
        process.chdir(saved.cwd);
        if (saved.base === undefined) delete process.env.REBASE_BASE_URL; else process.env.REBASE_BASE_URL = saved.base;
        if (saved.key === undefined) delete process.env.REBASE_SERVICE_KEY; else process.env.REBASE_SERVICE_KEY = saved.key;
        vi.unstubAllGlobals();
    });

    it("refuses to guess: no REBASE_BASE_URL and no running `rebase dev` sends nothing", async () => {
        fs.writeFileSync(path.join(root, ".env"), "REBASE_SERVICE_KEY=svc\nPORT=3001\n");
        await expect(resolveProjectTarget({}, { command: "data query" })).rejects.toMatchObject({ code: "no_target" });
    });

    it("sends the .env service key to REBASE_BASE_URL, and --token instead when given", async () => {
        fs.writeFileSync(path.join(root, ".env"), "REBASE_SERVICE_KEY=svc_local\nREBASE_BASE_URL=http://api.test\n");
        const seen: Array<{ url: string; auth: string | null }> = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
            seen.push({ url, auth: new Headers(init?.headers).get("Authorization") });
            return new Response("{}", { status: 200 });
        }));

        const service = await resolveProjectTarget({}, { command: "api" });
        await service.request("/api/data/posts", { query: { status: "eq.x" } });
        const token = await resolveProjectTarget({ "--token": "rk_test" }, { command: "api" });
        await token.request("/api/data/posts");
        const anon = await resolveProjectTarget({ "--anon": true }, { command: "api" });
        await anon.request("/api/data/posts");

        expect(seen).toEqual([
            { url: "http://api.test/api/data/posts?status=eq.x", auth: "Bearer svc_local" },
            { url: "http://api.test/api/data/posts", auth: "Bearer rk_test" },
            { url: "http://api.test/api/data/posts", auth: null }
        ]);
    });

    it("refuses two credentials, and a server and a cloud project, on one line", async () => {
        await expect(resolveProjectTarget({ "--token": "x", "--anon": true }, { command: "api" })).rejects.toBeInstanceOf(TargetError);
        await expect(resolveProjectTarget({ "--url": "http://a", "--project": "acme" }, { command: "api" })).rejects.toMatchObject({ code: "usage" });
    });

    it("needs a credential when the line names none and .env has no service key", async () => {
        await expect(resolveProjectTarget({ "--url": "http://api.test" }, { command: "data query" })).rejects.toMatchObject({ code: "no_credential" });
    });
});

describe("rebase data delete", () => {
    const saved = process.cwd();
    let root: string;
    let exits: number[];
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-data-delete-"));
        fs.writeFileSync(path.join(root, "rebase.json"), "{}");
        fs.writeFileSync(path.join(root, ".env"), "REBASE_SERVICE_KEY=svc\nREBASE_BASE_URL=http://api.test\n");
        process.chdir(root);
        exits = [];
        vi.spyOn(process, "exit").mockImplementation((code) => {
            exits.push(Number(code));
            throw new Error(`exit:${code}`);
        });
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => {
        process.chdir(saved);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("asks before it deletes, and refuses with nobody to ask", async () => {
        const fetched = vi.fn(async () => new Response("{}", { status: 200 }));
        vi.stubGlobal("fetch", fetched);

        await expect(dataCommand("delete", argv("data", "delete", "posts", "p1", "--json"))).rejects.toThrow("exit:1");

        expect(exits).toEqual([1]);
        expect(fetched).not.toHaveBeenCalled();
    });

    it("counts first, then deletes every row --where matches, with --yes", async () => {
        const calls: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method ?? "GET"} ${url}${init?.body ? ` ${String(init.body)}` : ""}`);
            return new Response(url.includes("/count") ? "{\"count\":2}" : "{\"meta\":{\"deleted\":2}}", { status: 200 });
        }));

        await dataCommand("delete", argv("data", "delete", "posts", "--where", "status=eq.draft", "--yes", "--json"));

        expect(calls).toEqual([
            "GET http://api.test/api/data/posts/count?status=eq.draft",
            "POST http://api.test/api/data/posts/bulk/delete {\"where\":{\"status\":\"eq.draft\"}}"
        ]);
    });
});
