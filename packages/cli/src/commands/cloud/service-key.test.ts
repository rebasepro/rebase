/**
 * `rebase cloud service-key [rotate]`: reading the service key's state and
 * rotating it. Pinned: the status read never carries the key; `rotate` asks
 * first (refused without `--yes` where it cannot ask) and calls the rotate
 * route once; `--json` is the control plane's answer; an unknown action is
 * refused before any call; it is a signed-in person's act.
 *
 * `--preview <name>`: prints that backend preview's own key from the previews
 * function, never production's; `rotate --preview` asks first and restarts
 * only the preview; an older control plane answers `not_served`; an access
 * token reaches it, as it reaches `env reveal`; `env reveal REBASE_SERVICE_KEY
 * --preview <name>` is the same call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireSessionClient: vi.fn(),
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "p1")
    };
});

import * as context from "./context";
import { fakeCloudClient } from "../../../test/helpers/cloud-client";
import { serviceKeyCommand } from "./service-key";
import { envCommand } from "./env";

const STATUS = { generation: 2, liveGeneration: 1, rotatedAt: "2026-10-25T10:00:00.000Z", pending: true };
const ROTATION = { generation: 3, state: "restarting" };
const PREVIEW_KEY = { preview: "new-quiz", url: "https://songbuzz--new-quiz.rebase.website", key: "REBASE_SERVICE_KEY", value: "rsk_preview_own" };
const PREVIEW_ROTATION = { preview: "new-quiz", url: "https://songbuzz--new-quiz.rebase.website", state: "restarting" };

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
}

const invoke = vi.fn(async (_name: string, _body: unknown, opts?: { method?: string; path?: string }) => {
    if (opts?.path === "p1/service-key/rotate") return ROTATION;
    if (opts?.path === "p1/service-key") return STATUS;
    if (opts?.path === "p1/new-quiz/service-key/reveal") return PREVIEW_KEY;
    if (opts?.path === "p1/new-quiz/service-key/rotate") return PREVIEW_ROTATION;
    throw new Error(`unexpected call ${opts?.path}`);
});

async function stdoutOf(run: () => Promise<unknown>): Promise<{ out: string; exited: boolean }> {
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
        await run();
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = orig;
        exit.mockRestore();
    }
    return { out: chunks.join(""), exited };
}

beforeEach(() => {
    setJsonModeForTest(true);
    vi.mocked(context.requireSessionClient).mockResolvedValue({
        client: fakeCloudClient({ invoke }),
        url: "https://cp.example"
    });
    vi.mocked(context.requireClient).mockResolvedValue({
        client: fakeCloudClient({ invoke }),
        url: "https://cp.example"
    });
});
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

describe("rebase cloud service-key", () => {
    it("reads the state, which never carries the key", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual(STATUS);
        expect(out).not.toMatch(/rsk_/);
        expect(invoke).toHaveBeenCalledWith("credentials", undefined, { method: "GET", path: "p1/service-key" });
        expect(context.requireSessionClient).toHaveBeenCalledWith(expect.any(Array), "rotate a project's service key");
    });

    it("refuses to rotate without --yes where it cannot ask, and calls nothing", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "rotate", "--json")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("rotates once with --yes, answering the control plane's rotation", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "rotate", "--yes", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual(ROTATION);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("credentials", {}, { path: "p1/service-key/rotate" });
    });

    it("refuses an unknown action before any call", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "reveal", "--json")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("unknown_command");
        expect(context.requireSessionClient).not.toHaveBeenCalled();
    });
});

describe("rebase cloud service-key --preview", () => {
    it("prints the preview's own key, from the previews function, never production's", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "--preview", "New-Quiz", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual(PREVIEW_KEY);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("previews", {}, { path: "p1/new-quiz/service-key/reveal" });
        expect(invoke).not.toHaveBeenCalledWith("credentials", expect.anything(), expect.anything());
    });

    it("reaches it with an access token, as `env reveal` does: no login required", async () => {
        await stdoutOf(() => serviceKeyCommand(argv("service-key", "--preview", "new-quiz", "--json")));
        expect(context.requireClient).toHaveBeenCalled();
        expect(context.requireSessionClient).not.toHaveBeenCalled();
    });

    it("refuses to rotate without --yes where it cannot ask, and calls nothing", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "rotate", "--preview", "new-quiz", "--json")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("rotates once with --yes, only the preview, answering without the key", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "rotate", "--preview", "new-quiz", "--yes", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual(PREVIEW_ROTATION);
        expect(out).not.toMatch(/rsk_/);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("previews", {}, { path: "p1/new-quiz/service-key/rotate" });
    });

    it("answers not_served on a control plane without the route, and changed nothing", async () => {
        invoke.mockImplementationOnce(async () => {
            throw Object.assign(new Error("No route for POST /p1/new-quiz/service-key/reveal"), { status: 404, code: "FUNCTION_NOT_FOUND" });
        });
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "--preview", "new-quiz", "--json")));
        expect(exited).toBe(true);
        const error = JSON.parse(out).error;
        expect(error.code).toBe("not_served");
        expect(error.message).toBe("This control plane does not serve a preview's own service key yet.");
    });

    it("passes the control plane's not_found through for a preview it does not have", async () => {
        invoke.mockImplementationOnce(async () => {
            throw Object.assign(new Error('No preview named "nope" on this project.'), { status: 404, code: "not_found" });
        });
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "--preview", "nope", "--json")));
        expect(exited).toBe(true);
        const error = JSON.parse(out).error;
        expect(error.code).toBe("not_found");
        expect(error.message).toMatch(/No preview named "nope"/);
    });

    it("takes the action on either side of the preview's name", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "--preview", "new-quiz", "rotate", "--yes", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual(PREVIEW_ROTATION);
        expect(invoke).toHaveBeenCalledWith("previews", {}, { path: "p1/new-quiz/service-key/rotate" });
    });

    it("refuses `rotate --preview` without a name, and a second word without --preview, before any call", async () => {
        for (const words of [["rotate", "--preview"], ["--preview"], ["rotate", "new-quiz"]]) {
            const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", ...words, "--yes", "--json")));
            expect(exited, words.join(" ")).toBe(true);
            expect(JSON.parse(out).error.code, words.join(" ")).toBe("usage");
        }
        expect(context.requireClient).not.toHaveBeenCalled();
        expect(context.requireSessionClient).not.toHaveBeenCalled();
    });

    it("refuses an empty name before any call", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "--preview", " ", "--json")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("usage");
        expect(context.requireClient).not.toHaveBeenCalled();
    });
});

describe("rebase cloud env reveal REBASE_SERVICE_KEY --preview", () => {
    it("is the same call as `service-key --preview`", async () => {
        const { out, exited } = await stdoutOf(() => envCommand("reveal", argv("env", "reveal", "REBASE_SERVICE_KEY", "--preview", "new-quiz", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual(PREVIEW_KEY);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("previews", {}, { path: "p1/new-quiz/service-key/reveal" });
    });

    it("refuses any other variable per preview, before any call", async () => {
        const { out, exited } = await stdoutOf(() => envCommand("reveal", argv("env", "reveal", "STRIPE_KEY", "--preview", "new-quiz", "--json")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("usage");
        expect(context.requireClient).not.toHaveBeenCalled();
    });
});
