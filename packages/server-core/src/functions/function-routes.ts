import { Hono } from "hono";
import { HonoEnv } from "../api/types";
import { LoadedFunction } from "./function-loader";

/**
 * Mount all loaded function routes under a single Hono router.
 *
 * Each function is mounted at `/<function-name>`, preserving
 * whatever HTTP methods and middleware the Hono sub-app defines.
 */
export function createFunctionRoutes(
    functions: LoadedFunction[]
): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    // Listing endpoint: GET / → list available functions
    router.get("/", (c) => {
        return c.json({
            functions: functions.map((fn) => ({
                name: fn.name,
                endpoint: `/functions/${fn.name}`,
            })),
        });
    });

    for (const fn of functions) {
        router.route(`/${fn.name}`, fn.app);
    }

    return router;
}
