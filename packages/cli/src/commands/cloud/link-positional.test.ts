/**
 * `rebase cloud link <slug>` links that project.
 *
 * The positional was read only as a URL: a slug was dropped, so on a terminal
 * the picker opened as though nothing had been named, and without one the
 * command asked for `--project`. Pinned: a positional slug is resolved and
 * written exactly as `--project` would be, a URL still links directly, and
 * naming two different projects is a usage error before any call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        resolveProjectRef: vi.fn(async () => "p1"),
        writeLink: vi.fn(),
        requireInteractive: vi.fn(() => {
            throw new Error("__picker__");
        })
    };
});

import * as context from "./context";
import { fakeCloudClient } from "../../../test/helpers/cloud-client";
import { linkCommand } from "./link";

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", "link", ...words];
}

const PROJECT = { id: "p1", name: "Triptelier", subdomain: "triptelier", organization: "org-9" };

beforeEach(() => {
    setJsonModeForTest(true);
    vi.mocked(context.requireClient).mockResolvedValue({
        client: fakeCloudClient({
            collection: () => ({ findById: (id: string) => (id === "p1" ? PROJECT : undefined) })
        }),
        url: "https://cp.example"
    });
});
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

async function run(args: string[]): Promise<{ out: string; exited: boolean }> {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
        chunks.push(typeof s === "string" ? s : String(s));
        return true;
    };
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("__exit__");
    });
    let exited = false;
    try {
        await linkCommand(args);
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = orig;
        exit.mockRestore();
    }
    return { out: chunks.join(""), exited };
}

describe("rebase cloud link <slug>", () => {
    it("links the project a positional slug names, without the picker", async () => {
        const { exited } = await run(argv("triptelier"));
        expect(exited).toBe(false);
        expect(context.requireInteractive).not.toHaveBeenCalled();
        expect(context.resolveProjectRef).toHaveBeenCalledWith("triptelier", expect.anything());
        expect(context.writeLink).toHaveBeenCalledWith(expect.objectContaining({
            projectId: "p1",
            slug: "triptelier",
            orgId: "org-9"
        }));
    });

    it("links the same way as --project", async () => {
        await run(argv("--project", "triptelier"));
        expect(context.resolveProjectRef).toHaveBeenCalledWith("triptelier", expect.anything());
        expect(context.writeLink).toHaveBeenCalledTimes(1);
    });

    it("accepts the slug named twice the same way", async () => {
        const { exited } = await run(argv("triptelier", "--project", "triptelier"));
        expect(exited).toBe(false);
        expect(context.writeLink).toHaveBeenCalledTimes(1);
    });

    it("refuses two different projects before any call", async () => {
        const { out, exited } = await run(argv("triptelier", "--project", "songbuzz"));
        expect(exited).toBe(true);
        expect(out).toContain("usage");
        expect(context.requireClient).not.toHaveBeenCalled();
        expect(context.writeLink).not.toHaveBeenCalled();
    });

    it("still opens the picker when nothing is named", async () => {
        await run(argv());
        expect(context.requireInteractive).toHaveBeenCalledTimes(1);
        expect(context.resolveProjectRef).not.toHaveBeenCalled();
        expect(context.writeLink).not.toHaveBeenCalled();
    });
});
