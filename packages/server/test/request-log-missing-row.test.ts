import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";

import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { requestLogger } from "../src/utils/request-logger";
import { logger } from "../src/utils/logger";
import type { DataDriver, RestFetchService } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { tablesFromCollections } from "./helpers/tables";

/**
 * A data read of a row that is not there logs at info, not warn.
 *
 * `GET /api/data/rooms/SMZJ` answering 404 is how the SDK's `findById` learns
 * the row is gone — it returns `null` — and an app looking up a code a user
 * typed asks it every time the code has expired. At warn, a `--level warn`
 * read of the log was mostly those. A write naming a missing row is still a
 * warning: it acts on an id the caller believed in.
 */
const players: LegacyCollectionConfig = {
    slug: "players",
    name: "Players",
    table: "players",
    properties: { id: { name: "ID", type: "string", isId: "manual" } }
};

const rooms: LegacyCollectionConfig = {
    slug: "rooms",
    name: "Rooms",
    table: "rooms",
    properties: {
        id: { name: "ID", type: "string", isId: "manual" },
        players: {
            name: "Players",
            type: "relation",
            relation: { kind: "hasMany", target: () => players, foreignKeyOnTarget: "room_id" }
        }
    }
};

function capture() {
    const lines: Array<{ level: string; message: string; data?: Record<string, unknown> }> = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation((message: string, data?: Record<string, unknown>) => {
            lines.push({ level, message, data });
        });
    }
    return lines;
}

function mount(): Hono<HonoEnv> {
    const driver: DataDriver = {
        fetchCollection: jest.fn<DataDriver["fetchCollection"]>(),
        fetchOne: jest.fn<DataDriver["fetchOne"]>().mockResolvedValue(undefined),
        save: jest.fn<DataDriver["save"]>(),
        delete: jest.fn<DataDriver["delete"]>(),
        checkUniqueField: jest.fn<DataDriver["checkUniqueField"]>(),
        count: jest.fn<NonNullable<DataDriver["count"]>>(),
        restFetchService: {
            fetchCollectionForRest: jest.fn<RestFetchService["fetchCollectionForRest"]>().mockResolvedValue([]),
            fetchOneForRest: jest.fn<RestFetchService["fetchOneForRest"]>().mockResolvedValue(null)
        }
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", requestLogger({ skip: [] }));
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        await next();
    });
    app.route("/api/data", new RestApiGenerator(tablesFromCollections([rooms, players]), driver).generateRoutes());
    return app;
}

const requestLines = (lines: ReturnType<typeof capture>) => lines.filter(line => line.message === "request");

describe("the request log of a missing row", () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it("writes a read by id that finds nothing at info", async () => {
        const lines = capture();

        const res = await mount().request("/api/data/rooms/SMZJ");

        expect(res.status).toBe(404);
        const [only, ...rest] = requestLines(lines);
        expect(rest).toHaveLength(0);
        expect(only.level).toBe("info");
        expect(only.data).toMatchObject({ status: 404, errorCode: "NOT_FOUND", collection: "rooms" });
        expect(String(only.data?.errorMessage)).toContain("No row with id 'SMZJ' in 'rooms'");
        // Nothing else spoke up about it at warn either.
        expect(lines.filter(line => line.level === "warn" || line.level === "error")).toHaveLength(0);
    });

    it("writes a nested read by id that finds nothing at info", async () => {
        const lines = capture();

        const res = await mount().request("/api/data/rooms/SMZJ/players/p1");

        expect(res.status).toBe(404);
        expect(requestLines(lines).map(line => [line.level, line.data?.errorCode])).toEqual([["info", "NOT_FOUND"]]);
    });

    it("keeps a delete of a missing row at warn", async () => {
        const lines = capture();

        const res = await mount().request("/api/data/rooms/SMZJ", { method: "DELETE" });

        expect(res.status).toBe(404);
        expect(requestLines(lines).map(line => [line.level, line.data?.errorCode])).toEqual([["warn", "NOT_FOUND"]]);
    });
});
