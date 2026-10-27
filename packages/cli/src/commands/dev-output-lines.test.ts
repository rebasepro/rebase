/**
 * `rebase dev` reads its children's output a line at a time, across chunks.
 *
 * A pipe hands over whatever has been written so far, so one line can arrive in
 * two chunks. Split chunk by chunk, "Server running at http://localhost:3001"
 * read as two fragments that neither matched, and `rebase dev` never
 * announced the backend, never wrote `.rebase-dev-port`, and never started the
 * admin panel.
 */
import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectionChangeSummary, forEachOutputLine } from "./dev";

function collect(idleFlushMs?: number) {
    const stream = new PassThrough();
    const lines: string[] = [];
    forEachOutputLine(stream, (line) => lines.push(line), idleFlushMs);
    return { stream, lines };
}

describe("forEachOutputLine", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("joins a line written across two chunks", async () => {
        const { stream, lines } = collect();

        stream.write("[tsx] watching\nServer running at http://loc");
        stream.write("alhost:3001\nnext line\n");
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toEqual(["[tsx] watching", "Server running at http://localhost:3001", "next line"]);
    });

    it("joins a character split across chunks", async () => {
        const { stream, lines } = collect();
        const arrow = Buffer.from("↳ PORT = 3014\n");

        stream.write(arrow.subarray(0, 1));
        stream.write(arrow.subarray(1));
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toEqual(["↳ PORT = 3014"]);
    });

    it("hands over the last line when the stream ends without a newline", async () => {
        const { stream, lines } = collect();

        stream.end("Server running at http://localhost:3002");
        await new Promise((resolve) => stream.on("end", resolve));

        expect(lines).toEqual(["Server running at http://localhost:3002"]);
    });

    it("does not sit on a line that never gets its newline", async () => {
        // A prompt or a progress line is shown when it is written, not when the
        // next line arrives.
        vi.useFakeTimers();
        const { stream, lines } = collect(100);

        stream.write("Waiting for the database");
        await vi.advanceTimersByTimeAsync(0);
        expect(lines).toEqual([]);

        await vi.advanceTimersByTimeAsync(100);
        expect(lines).toEqual(["Waiting for the database"]);

        stream.write("…\n");
        await vi.advanceTimersByTimeAsync(0);
        expect(lines).toEqual(["Waiting for the database", "…"]);
    });
});

describe("collectionChangeSummary: what dev says after a collection edit", () => {
    // eslint-disable-next-line no-control-regex
    const plain = (lines: string[]) => lines.join("\n").replace(/\u001b\[[0-9;]*m/g, "");

    it("says regenerated only when both halves were", () => {
        expect(plain(collectionChangeSummary("generated", "generated"))).toContain("✓ Schema and SDK types regenerated");
    });

    it("never prints the success line after a failed regeneration, and names what failed", () => {
        const schemaFailed = plain(collectionChangeSummary("failed", "generated"));
        expect(schemaFailed).not.toContain("regenerated.");
        expect(schemaFailed).not.toContain("✓");
        expect(schemaFailed).toContain("Not regenerated: the database schema");

        const both = plain(collectionChangeSummary("failed", "failed"));
        expect(both).toContain("the database schema and the SDK types");
        expect(plain(collectionChangeSummary("generated", "failed"))).toContain("Not regenerated: the SDK types");
    });
});
