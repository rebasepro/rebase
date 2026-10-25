/**
 * `rebase cloud notifications`: the exact requests each action makes, and the
 * refusals that keep a wrong line off the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "proj_1"),
        displayProjectRef: vi.fn(() => "shop")
    };
});

import * as context from "./context";
import { notificationsCommand, parseNotificationEvents } from "./notifications";

const argv = (...words: string[]) => ["node", "rebase", "cloud", "notifications", ...words];

/** Run `run` in JSON mode and return the single JSON value it printed, and whether it exited. */
async function capture(run: () => Promise<unknown>): Promise<{ out: Record<string, unknown>; exited: boolean }> {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => { chunks.push(String(s)); return true; }) as typeof process.stdout.write;
    const exit = vi.spyOn(process, "exit").mockImplementation(((): never => { throw new Error("__exit__"); }) as never);
    let exited = false;
    try {
        await run();
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = origWrite;
        exit.mockRestore();
    }
    return { out: JSON.parse(chunks.join("").trim() || "{}"), exited };
}

function fakeClient(answer: (fn: string, body: unknown, opts: { method?: string; path?: string }) => unknown) {
    const invoke = vi.fn(async (fn: string, body: unknown, opts: { method?: string; path?: string } = {}) => answer(fn, body, opts));
    vi.mocked(context.requireClient).mockResolvedValue({ client: { functions: { invoke } }, url: "https://cp.example" } as never);
    return invoke;
}

beforeEach(() => setJsonModeForTest(true));
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

describe("parseNotificationEvents", () => {
    it("defaults to failed deploys and de-duplicates", () => {
        expect(parseNotificationEvents(undefined)).toEqual(["deploy.failed"]);
        expect(parseNotificationEvents("deploy.failed, backup.unhealthy,deploy.failed")).toEqual(["deploy.failed", "backup.unhealthy"]);
    });
});

describe("notifications add", () => {
    it("posts the URL, events and format for the linked project, and prints the secret once", async () => {
        const invoke = fakeClient(() => ({ webhook: { id: "w1", url: "https://hooks.slack.com/…XXXX", events: ["deploy.failed"] }, secret: "whsec_abc" }));
        const { out, exited } = await capture(() => notificationsCommand("add", argv(
            "add", "https://hooks.slack.com/services/T0/B0/XXXX", "--events", "deploy.failed,usage.threshold", "--format", "slack"
        )));
        expect(exited).toBe(false);
        expect(invoke).toHaveBeenCalledWith(
            "notifications",
            { projectId: "proj_1", url: "https://hooks.slack.com/services/T0/B0/XXXX", events: ["deploy.failed", "usage.threshold"], format: "slack" },
            { path: "webhooks" }
        );
        expect(out.secret).toBe("whsec_abc");
        expect(out.projectId).toBe("proj_1");
    });

    it("refuses an unknown event and a missing URL before any request", async () => {
        const invoke = fakeClient(() => ({}));
        const unknown = await capture(() => notificationsCommand("add", argv("add", "https://x.test", "--events", "deploy.exploded")));
        expect(unknown.exited).toBe(true);
        expect((unknown.out.error as { code: string }).code).toBe("usage");
        const missing = await capture(() => notificationsCommand("add", argv("add", "--events", "deploy.failed")));
        expect((missing.out.error as { hint: string }).hint).toContain("--url");
        const badFormat = await capture(() => notificationsCommand("add", argv("add", "https://x.test", "--format", "xml")));
        expect(badFormat.exited).toBe(true);
        expect(invoke).not.toHaveBeenCalled();
        expect(context.requireClient).not.toHaveBeenCalled();
    });

    it("never takes the control plane's --url as the destination", async () => {
        const invoke = fakeClient(() => ({ webhook: { id: "w1", url: "x", events: [] }, secret: "s" }));
        await capture(() => notificationsCommand("add", argv("add", "https://hooks.example.test/a", "--url", "https://cp.example")));
        expect((invoke.mock.calls[0][1] as { url: string }).url).toBe("https://hooks.example.test/a");
    });
});

describe("notifications test", () => {
    it("exits 1 with delivery_failed when the receiver refused it", async () => {
        const invoke = fakeClient(() => ({ success: false, statusCode: 404, error: "no_service", attempts: 1 }));
        const { out, exited } = await capture(() => notificationsCommand("test", argv("test", "w1")));
        expect(invoke).toHaveBeenCalledWith("notifications", {}, { path: "webhooks/w1/test" });
        expect(exited).toBe(true);
        expect(out.error).toMatchObject({ code: "delivery_failed", hint: "no_service" });
    });

    it("reports a delivery", async () => {
        fakeClient(() => ({ success: true, statusCode: 204, error: "", attempts: 1 }));
        const { out, exited } = await capture(() => notificationsCommand("test", argv("test", "w1")));
        expect(exited).toBe(false);
        expect(out).toMatchObject({ id: "w1", success: true, statusCode: 204 });
    });
});

describe("notifications remove", () => {
    it("needs --yes off a terminal, and then deletes the one named", async () => {
        const invoke = fakeClient(() => ({ deleted: "w1" }));
        const refused = await capture(() => notificationsCommand("remove", argv("remove", "w1")));
        expect((refused.out.error as { code: string }).code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalled();

        const done = await capture(() => notificationsCommand("remove", argv("remove", "w1", "--yes")));
        expect(done.exited).toBe(false);
        expect(invoke).toHaveBeenCalledWith("notifications", undefined, { method: "DELETE", path: "webhooks/w1" });
    });
});

describe("notifications list", () => {
    it("lists the linked project's destinations as JSON", async () => {
        const invoke = fakeClient(() => ({ webhooks: [{ id: "w1", url: "https://hooks.slack.com/…XXXX", events: ["deploy.failed"], enabled: true }] }));
        const { out } = await capture(() => notificationsCommand(undefined, argv()));
        expect(invoke).toHaveBeenCalledWith("notifications", undefined, { method: "GET", path: "webhooks?projectId=proj_1" });
        expect(out).toMatchObject({ projectId: "proj_1", webhooks: [{ id: "w1" }] });
    });

    it("refuses a mistyped action", async () => {
        const { out } = await capture(() => notificationsCommand("ad", argv("ad")));
        expect((out.error as { code: string }).code).toBe("unknown_command");
    });
});
