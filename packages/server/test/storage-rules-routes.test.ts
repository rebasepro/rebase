import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
/**
 * `STORAGE_POLICIES` through the storage routes of a booted backend.
 *
 * A project that runs no code of its own — the managed runtime's stock backend,
 * a Rebase Cloud project — could only choose between every file public and
 * every signed-in user touching every file. The rules give it "each user owns
 * their folder" and "admins reach everything" as data. These boot a production
 * backend from the variable's value, as the managed runtime does, and ask the
 * routes as different callers.
 */
import { Hono } from "hono";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initializeRebaseBackend } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, idleServer } from "./helpers/server-b-fakes";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createCustomAuthAdapter } from "../src/auth/custom-auth-adapter";
import { configureJwt } from "../src/auth/jwt";
import { storagePoliciesFromEnv } from "../src/storage/policy-rules";

const STORAGE_POLICIES = JSON.stringify([
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: "owner" },
    { path: "**", allow: { roles: ["admin"] } }
]);

describe("storage rules from STORAGE_POLICIES, on the routes", () => {
    let root: string;
    let app: Hono<HonoEnv>;
    const originalNodeEnv = process.env.NODE_ENV;
    /** `Bearer <uid>[:<role>,<role>]`, which the adapter below reads as that user. */
    const bearer = async (uid: string, roles: string[] = []) => ({ authorization: `Bearer ${uid}${roles.length ? `:${roles.join(",")}` : ""}` });

    beforeAll(async () => {
        // Production: the guard that refuses storage with no access model
        // must be satisfied by the rules alone.
        process.env.NODE_ENV = "production";
        // The file routes verify download tokens with it, whoever signs callers in.
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-rules-"));
        const storage = new LocalStorageController({ type: "local", basePath: root });
        for (const key of ["public/logo.txt", "users/ada/notes.txt", "users/grace/notes.txt", "reports/q3.txt"]) {
            await storage.putObject({ file: new File([Buffer.from(key)], path.basename(key), { type: "text/plain" }), key });
        }
        app = new Hono<HonoEnv>();
        await initializeRebaseBackend({
            app,
            server: idleServer(),
            bootstrappers: [fakeBootstrapper()],
            storage: { "(default)": storage },
            storagePolicies: storagePoliciesFromEnv(STORAGE_POLICIES),
            auth: createCustomAuthAdapter({
                verifyRequest: async (request) => {
                    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
                    if (!token) return null;
                    const [uid, roles = ""] = token.split(":");
                    const roleList = roles ? roles.split(",") : [];
                    return { uid, email: `${uid}@example.com`, roles: roleList, isAdmin: roleList.includes("admin") };
                }
            })
        });
    });

    afterAll(async () => {
        process.env.NODE_ENV = originalNodeEnv;
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    /**
     * A read as a client makes one: anonymous straight from `/file` (public
     * keys), signed in through `/metadata`, which runs the same check and
     * mints the download token — `/file` takes no bearer token.
     */
    const read = async (key: string, headers: Record<string, string> = {}) =>
        (await app.request(headers.authorization ? `/api/storage/metadata/${key}` : `/api/storage/file/${key}`, { headers })).status;
    const remove = async (key: string, headers: Record<string, string>) =>
        (await app.request(`/api/storage/file/${key}`, { method: "DELETE", headers })).status;
    const upload = async (key: string, headers: Record<string, string>) => {
        const form = new FormData();
        form.append("file", new File(["hi"], path.basename(key), { type: "text/plain" }));
        form.append("key", key);
        return (await app.request("/api/storage/upload", { method: "POST", body: form, headers })).status;
    };

    it("serves public/ to a caller with no token", async () => {
        expect(await read("public/logo.txt")).toBe(200);
    });

    it("lets a user read and write their own folder", async () => {
        const ada = await bearer("ada");
        expect(await read("users/ada/notes.txt", ada)).toBe(200);
        expect(await upload("users/ada/new.txt", ada)).toBe(201);
    });

    it("refuses a user another user's folder, and a key no rule gives them", async () => {
        const ada = await bearer("ada");
        expect(await read("users/grace/notes.txt", ada)).toBe(403);
        expect(await upload("users/grace/planted.txt", ada)).toBe(403);
        expect(await remove("users/grace/notes.txt", ada)).toBe(403);
        expect(await read("reports/q3.txt", ada)).toBe(403);
        expect(await upload("public/defaced.txt", ada)).toBe(403);
    });

    it("lets an admin reach every key", async () => {
        const admin = await bearer("root", ["admin"]);
        expect(await read("reports/q3.txt", admin)).toBe(200);
        expect(await read("users/grace/notes.txt", admin)).toBe(200);
        expect([200, 204]).toContain(await remove("users/grace/notes.txt", admin));
    });
});
