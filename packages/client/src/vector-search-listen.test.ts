/**
 * `.vectorSearch(…).listen()` must reach the server's refusal.
 *
 * `realtimeService` rejects a subscription carrying `vectorSearch` — a
 * subscription is re-run on every matching write and nothing there computes
 * distances — and the documentation promises that refusal. Both producers of a
 * subscription request hand-list their fields, and both omitted this one, so
 * the guard could not fire: the call returned an ordinary `id DESC` listing,
 * with no `_distance` and no error. Through `observe()` it was worse, because
 * the correct initial snapshot was then overwritten by the wrong socket
 * listing.
 *
 * Asserted on the request the client BUILDS rather than on a live socket: what
 * was missing is a field, and the refusal it has to reach is tested where it
 * lives.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const listenRequestBlock = (file: string, marker: string) => {
    const source = readFileSync(resolve(__dirname, file), "utf-8");
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, start + 3000);
};

describe("a subscription request carries every field the server refuses on", () => {
    it("the client's listenCollection forwards vectorSearch", () => {
        const block = listenRequestBlock("./collection.ts", "ws.listenCollection(");
        expect(block).toContain("vectorSearch: params?.vectorSearch");
    });

    it("forwards it beside the fields it already forwarded", () => {
        // Guards against the assertion above passing on a stray mention: the
        // field has to be in the same object literal as the rest.
        const block = listenRequestBlock("./collection.ts", "ws.listenCollection(");
        const objectLiteral = block.slice(0, block.indexOf("},"));
        for (const field of ["path:", "filter:", "orderBy:", "searchString:", "vectorSearch:"]) {
            expect(objectLiteral).toContain(field);
        }
    });
});
