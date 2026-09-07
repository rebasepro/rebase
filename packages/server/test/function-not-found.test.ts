import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";

import { createFunctionRoutes } from "../src/functions/function-routes";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";

/**
 * A typo'd function name is the most likely 404 on this surface, and it used to
 * be a `text/plain` one.
 *
 * `/api/functions/*` mounted no catch-all, so an unknown name fell through to
 * Hono's default `404 Not Found`. Through the SDK that arrived as
 * `RebaseApiError { message: "Not Found", code: undefined }`, so the documented
 * `e.code === "FUNCTION_NOT_FOUND"` branch could never run — and the loader,
 * which knew perfectly well that `broken.ts` had failed to import, said nothing
 * here.
 */
const hello = new Hono<HonoEnv>();
hello.get("/", (c) => c.json({ ok: true }));

function app(options: {
    functions?: { name: string; app: Hono<HonoEnv> }[];
    problems?: string[];
    identified?: boolean;
} = {}) {
    const a = new Hono<HonoEnv>();
    a.onError(errorHandler);
    if (options.identified) {
        a.use("/*", async (c, next) => {
            c.set("user", { uid: "u1", roles: [] } as never);
            await next();
        });
    }
    a.route("/", createFunctionRoutes(
        (options.functions ?? [{ name: "hello", app: hello }]) as never,
        options.problems ?? [],
        "/api/functions"
    ));
    return a;
}

const body = async (res: Response) =>
    await res.json() as { error: { code: string; message: string; details?: { function?: string } } };

describe("an unknown function name", () => {
    it("is a JSON 404 with FUNCTION_NOT_FOUND", async () => {
        const res = await app().request("/nope");

        expect(res.status).toBe(404);
        expect(res.headers.get("content-type")).toContain("application/json");
        const { error } = await body(res);
        expect(error.code).toBe("FUNCTION_NOT_FOUND");
        expect(error.message).toContain("nope");
        expect(error.details?.function).toBe("nope");
    });

    it("names what is served — to a caller the server could identify", async () => {
        const { error } = await body(await app({ identified: true }).request("/nope"));
        expect(error.message).toContain("hello");
    });

    it("names nothing to an anonymous caller", async () => {
        // The mounted names are an inventory of every custom endpoint, which is
        // exactly what `GET /api/functions` requires an identity to see.
        const { error } = await body(await app().request("/nope"));
        expect(error.message).not.toContain("hello");
    });

    it("says when a file of that name failed to load", async () => {
        const { error } = await body(await app({
            functions: [],
            problems: ["broken.ts (threw: Cannot find module 'nowhere')"]
        }).request("/broken"));

        expect(error.code).toBe("FUNCTION_NOT_FOUND");
        expect(error.message).toContain("broken.ts");
        expect(error.message).toContain("failed to load");
        // The reason stays in the server log: it carries import paths.
        expect(error.message).not.toContain("Cannot find module");
    });

    it("distinguishes a served function with no route at that path", async () => {
        const { error } = await body(await app().request("/hello/nope"));
        expect(error.code).toBe("FUNCTION_NOT_FOUND");
        expect(error.message).toContain("'hello' is served");
        expect(error.message).toContain("/nope");
    });

    it("leaves a real function route alone", async () => {
        const res = await app().request("/hello");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });

    it("answers every method", async () => {
        for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
            const res = await app().request("/nope", { method });
            expect(res.status).toBe(404);
            expect((await body(res)).error.code).toBe("FUNCTION_NOT_FOUND");
        }
    });
});
