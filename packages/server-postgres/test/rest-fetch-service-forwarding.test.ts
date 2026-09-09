/**
 * Both `restFetchService` getters must forward every method they have.
 *
 * Neither getter returns the real `FetchService`. Each builds a fresh object
 * literal — the base one to layer `afterRead` masking on, the authenticated one
 * to wrap the reads in the RLS transaction — and that literal is the only thing
 * the REST route can see. So a method left off it does not fall through to the
 * implementation underneath; it reads to the route as a driver that cannot do
 * the thing, and the feature is silently missing on every deployment.
 *
 * That has now happened twice:
 *
 *   - `aggregate` was omitted, so `GET /api/data/:slug/aggregate` answered 501
 *     on every Postgres deployment — including the one the 501's own message
 *     said it was describing.
 *   - `cursorFor` was omitted, so `readPage` could never put a `nextCursor` in
 *     `meta`. The server accepted `?after=` and issued no cursor to put in it,
 *     which means keyset pagination could not be *started* by any client. Found
 *     by paging a freshly scaffolded project by hand.
 *
 * Both times the fix was one line, and both times nothing failed until someone
 * used the feature. So this asserts the property rather than the two names: the
 * members are read out of the `RestFetchService` interface in `@rebasepro/types`,
 * which is the contract the route programs against, and a member added there is
 * a member both getters must carry. Reading the source text rather than the
 * type is deliberate — an interface leaves nothing behind at runtime to reflect
 * over, and the same trick already guards the collection editor's mirror.
 */
import { describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { AuthenticatedPostgresBackendDriver, PostgresBackendDriver } from "../src/PostgresBackendDriver";
import type { RealtimeService } from "../src/services/realtimeService";

/** The member names declared on `interface RestFetchService`. */
function restFetchServiceMembers(): string[] {
    const file = path.resolve(
        __dirname,
        "../../types/src/controllers/data_driver.ts"
    );
    const source = fs.readFileSync(file, "utf8");
    const start = source.search(/^export interface RestFetchService\b[^{]*\{/m);
    expect(start).toBeGreaterThanOrEqual(0);

    let depth = 0;
    const names: string[] = [];
    let line = "";
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        const c = source[i];
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) break; }
        if (c !== "\n") { line += c; continue; }
        // Only the interface's own members: one indent, then a name.
        if (depth === 1) {
            const member = /^\s{4}([a-zA-Z_][a-zA-Z0-9_]*)\??\s*[(<]/.exec(line);
            if (member) names.push(member[1]);
        }
        line = "";
    }
    return names;
}

const stubDb = {} as unknown as NodePgDatabase;
const stubRealtime = {} as unknown as RealtimeService;
const stubRegistry = {
    getCollectionByPath: () => ({ slug: "widgets", properties: {} }),
    getCollections: () => [],
    getTable: () => ({}),
    getGlobalCallbacks: () => undefined
} as never;

describe("the restFetchService wrappers forward the whole interface", () => {
    const members = restFetchServiceMembers();

    it("reads a non-empty member list, so a rename cannot pass vacuously", () => {
        // If the parse breaks, every assertion below becomes trivially true.
        expect(members).toEqual(expect.arrayContaining([
            "fetchCollectionForRest",
            "fetchOneForRest",
            "aggregate",
            "cursorFor"
        ]));
    });

    it("the base driver exposes every one of them", () => {
        const driver = new PostgresBackendDriver(stubDb, stubRealtime, stubRegistry);
        const wrapper = driver.restFetchService as unknown as Record<string, unknown>;
        const missing = members.filter(name => typeof wrapper[name] !== "function");
        expect({ missing }).toEqual({ missing: [] });
    });

    it("the request-scoped driver exposes every one of them", () => {
        const delegate = new PostgresBackendDriver(stubDb, stubRealtime, stubRegistry);
        const scoped = new AuthenticatedPostgresBackendDriver(
            delegate,
            { uid: "u1", roles: ["admin"] } as never
        );
        const wrapper = scoped.restFetchService as unknown as Record<string, unknown>;
        const missing = members.filter(name => typeof wrapper[name] !== "function");
        expect({ missing }).toEqual({ missing: [] });
    });
});
