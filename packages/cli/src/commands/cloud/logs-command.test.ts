/**
 * `rebase cloud logs` end to end against a fake control plane: the flags,
 * `--runtime --follow` really following and stopping on Ctrl-C with exit 0,
 * NDJSON under `--json`, and `--preview` reading the preview — never
 * production — for both the build and the runtime log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        resolveProjectRef: vi.fn(async () => "proj_1")
    };
});

import * as context from "./context";
import { logsCommand } from "./deploy";
import { PREVIEW_DEPLOYMENTS_COLLECTION } from "./previews";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const T = (s: number): string => `2026-10-24T10:00:${String(s).padStart(2, "0")}.000000000Z`;
const line = (s: number, text: string, pod = "rebase-backend-a"): string => `${T(s)} [${pod}] ${text}`;
const page = (lines: string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    logs: lines.join("\n"),
    state: "ok",
    pods: [{ pod: "rebase-backend-a", state: "ok", lines: lines.length, message: null, hint: null, restarts: 0 }],
    ...extra
});

const argv = (...rest: string[]): string[] => ["node", "rebase", "cloud", "logs", ...rest];

interface Fake {
    invoke: ReturnType<typeof vi.fn>;
    collections: string[];
}

/** A control plane whose `runtime-logs` answers `pages` in turn (the last repeats). */
function fakeControlPlane(opts: {
    pages?: Array<Record<string, unknown>>;
    previews?: Array<Record<string, unknown>>;
    rows?: Record<string, Array<Record<string, unknown>>>;
}): Fake {
    let served = 0;
    const reads: Record<string, number> = {};
    const collections: string[] = [];
    const invoke = vi.fn(async (name: string, _payload: unknown, o: { path: string }) => {
        if (name === "previews") return { previews: opts.previews ?? [] };
        if (name === "runtime-logs") {
            const pages = opts.pages ?? [page([])];
            const answer = pages[Math.min(served++, pages.length - 1)];
            // A control plane that understands `?preview=` echoes it.
            const preview = new URLSearchParams(o.path.split("?")[1] ?? "").get("preview");
            return preview && !("preview" in answer) ? { ...answer, preview } : answer;
        }
        throw new Error(`unexpected function ${name}`);
    });
    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: {
            functions: { invoke },
            data: {
                collection: (name: string) => {
                    collections.push(name);
                    const rows = opts.rows?.[name] ?? [];
                    return {
                        find: async () => ({ data: rows.slice(0, 1) }),
                        findById: async () => {
                            const i = reads[name] ?? 0;
                            reads[name] = i + 1;
                            return rows[Math.min(i, rows.length - 1)];
                        }
                    };
                }
            }
        },
        url: "https://cp.example"
    });
    return { invoke, collections };
}

const runtimePaths = (f: Fake): string[] =>
    f.invoke.mock.calls.filter((c) => c[0] === "runtime-logs").map((c) => (c[2] as { path: string }).path);

describe("rebase cloud logs", () => {
    let stdout: string[];
    let stderr: string[];
    let sigint: (() => void) | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        stdout = [];
        stderr = [];
        sigint = undefined;
        vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
            stdout.push(String(chunk));
            return true;
        }) as typeof process.stdout.write);
        vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
            stderr.push(String(chunk));
            return true;
        }) as typeof process.stderr.write);
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
            stdout.push(`${args.map(String).join(" ")}\n`);
        });
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            stderr.push(`${args.map(String).join(" ")}\n`);
        });
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Exited(code ?? 0);
        }) as never);
        // Ctrl-C, without signalling the test runner itself.
        const once = process.once.bind(process);
        vi.spyOn(process, "once").mockImplementation(((event: string, listener: () => void) => {
            if (event === "SIGINT") {
                sigint = listener;
                return process;
            }
            return once(event, listener);
        }) as typeof process.once);
        context.setJsonModeForTest(false);
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockClear();
    });

    afterEach(() => {
        context.setJsonModeForTest(false);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe("--runtime --follow", () => {
        it("keeps polling — `-f` used to print one snapshot and exit", async () => {
            const f = fakeControlPlane({
                pages: [page([line(1, "booting")]), page([line(1, "booting"), line(2, "ready")]), page([line(3, "GET / 200")])]
            });

            const done = logsCommand(argv("--runtime", "-f"), "shop");
            await vi.advanceTimersByTimeAsync(7_000);
            expect(runtimePaths(f).length).toBeGreaterThanOrEqual(2);
            sigint?.();
            await vi.advanceTimersByTimeAsync(2_000);
            await done;

            const out = stdout.join("");
            // Each line exactly once, although the second poll returned the first again.
            expect(out.match(/booting/g)).toHaveLength(1);
            expect(out).toContain("ready");
            expect(out).toContain("GET / 200");
        });

        it("exits 0 on Ctrl-C", async () => {
            fakeControlPlane({ pages: [page([line(1, "a")])] });

            const done = logsCommand(argv("--runtime", "--follow"), "shop");
            await vi.advanceTimersByTimeAsync(3_000);
            expect(sigint).toBeTypeOf("function");
            sigint?.();
            await vi.advanceTimersByTimeAsync(100);

            await expect(done).resolves.toBeUndefined();
            expect(process.exit).not.toHaveBeenCalled();
            expect(stderr.join("")).toContain("Stopped.");
        });

        it("emits NDJSON under --json: one object per line, as each arrives", async () => {
            context.setJsonModeForTest(true);
            fakeControlPlane({ pages: [page([line(1, '{"severity":"ERROR","message":"boom"}')]), page([line(2, "b")])] });

            const done = logsCommand(argv("--runtime", "-f", "--json"), "shop");
            await vi.advanceTimersByTimeAsync(3_000);
            sigint?.();
            await vi.advanceTimersByTimeAsync(2_000);
            await done;

            const records = stdout.join("").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
            expect(records).toEqual([
                { type: "line", ts: T(1), pod: "rebase-backend-a", text: '{"severity":"ERROR","message":"boom"}' },
                { type: "line", ts: T(2), pod: "rebase-backend-a", text: "b" }
            ]);
        });

        it("asks for what --since and --tail say on the first poll, then follows the cursor", async () => {
            const f = fakeControlPlane({ pages: [page([line(1, "a")]), page([])] });

            const done = logsCommand(argv("--runtime", "-f", "--since", "5m", "--tail", "50"), "shop");
            await vi.advanceTimersByTimeAsync(3_000);
            sigint?.();
            await vi.advanceTimersByTimeAsync(2_000);
            await done;

            const [first, second] = runtimePaths(f).map((p) => new URLSearchParams(p.split("?")[1]));
            expect(first.get("sinceSeconds")).toBe("300");
            expect(first.get("tailLines")).toBe("50");
            expect(second.get("sinceTime")).toBe("2026-10-24T10:00:00.999Z");
            expect(second.has("sinceSeconds")).toBe(false);
        });

        it("prints only the lines --level keeps", async () => {
            fakeControlPlane({
                pages: [page([line(1, '{"severity":"INFO","message":"fine"}'), line(2, '{"severity":"ERROR","message":"broken"}')])]
            });

            const done = logsCommand(argv("--runtime", "-f", "--level", "error"), "shop");
            await vi.advanceTimersByTimeAsync(1_000);
            sigint?.();
            await vi.advanceTimersByTimeAsync(2_000);
            await done;

            expect(stdout.join("")).toContain("broken");
            expect(stdout.join("")).not.toContain("fine");
        });
    });

    describe("--runtime, once", () => {
        it("filters with --grep and keeps the JSON a single object", async () => {
            context.setJsonModeForTest(true);
            const f = fakeControlPlane({ pages: [page([line(1, "GET /a 200"), line(2, "GET /b 500")], { nextSinceTime: T(2) })] });

            await logsCommand(argv("--runtime", "--grep", "/ 5\\d\\d$/", "--json"), "shop");

            expect(runtimePaths(f)).toHaveLength(1);
            const result = JSON.parse(stdout.join("")) as Record<string, unknown>;
            expect(result).toMatchObject({ runtime: true, preview: null, logs: line(2, "GET /b 500"), nextSinceTime: T(2) });
        });

        it("sends --previous", async () => {
            const f = fakeControlPlane({ pages: [page([line(1, "crashed")])] });
            await logsCommand(argv("--runtime", "--previous"), "shop");
            expect(new URLSearchParams(runtimePaths(f)[0].split("?")[1]).get("previous")).toBe("true");
        });
    });

    describe("usage", () => {
        const refused = async (...rest: string[]): Promise<string> => {
            fakeControlPlane({});
            await expect(logsCommand(argv(...rest), "shop")).rejects.toMatchObject({ code: 1 });
            return stderr.join("");
        };

        it("refuses runtime filters on the build log rather than ignoring them", async () => {
            expect(await refused("--grep", "x")).toContain("--runtime");
            expect(await refused("--since", "5m")).toContain("--runtime");
        });

        it("refuses following a stopped instance", async () => {
            expect(await refused("--runtime", "--previous", "-f")).toContain("--previous");
        });

        it("refuses a --since that is not a duration or a time", async () => {
            expect(await refused("--runtime", "--since", "yesterday")).toContain("--since");
        });

        it("refuses a --level that is not a level", async () => {
            expect(await refused("--runtime", "--level", "loud")).toContain("--level");
        });

        it("refuses a broken --grep pattern before any request", async () => {
            expect(await refused("--runtime", "--grep", "/(/")).toContain("--grep");
            expect(context.requireClient).not.toHaveBeenCalled();
        });
    });

    describe("--preview", () => {
        const PREVIEW = {
            name: "new-quiz",
            url: "https://shop--new-quiz.rebase.website",
            backend: "preview",
            status: "failed",
            deploymentId: "pd_9"
        };

        it("prints the preview's build log, from the preview's deployment — not production's", async () => {
            context.setJsonModeForTest(true);
            const f = fakeControlPlane({
                previews: [PREVIEW],
                rows: {
                    [PREVIEW_DEPLOYMENTS_COLLECTION]: [{ id: "pd_9", status: "failed", logs: "❌ Preview deploy failed: rollout timed out\n" }],
                    deployments: [{ id: "prod_1", status: "success", logs: "production build\n" }]
                }
            });

            await logsCommand(argv("--preview", "new-quiz", "--json"), "shop");

            expect(f.collections).toEqual([PREVIEW_DEPLOYMENTS_COLLECTION]);
            expect(JSON.parse(stdout.join(""))).toEqual({
                preview: "new-quiz",
                deploymentId: "pd_9",
                status: "failed",
                logs: "❌ Preview deploy failed: rollout timed out\n"
            });
        });

        it("finds a preview by the deployment id a failed preview deploy printed", async () => {
            context.setJsonModeForTest(true);
            fakeControlPlane({
                previews: [PREVIEW],
                rows: { [PREVIEW_DEPLOYMENTS_COLLECTION]: [{ id: "pd_9", status: "failed", logs: "x\n" }] }
            });

            await logsCommand(argv("--preview", "pd_9", "--json"), "shop");

            expect(JSON.parse(stdout.join(""))).toMatchObject({ preview: "new-quiz", deploymentId: "pd_9" });
        });

        it("names the previews there are when the one asked for is not", async () => {
            fakeControlPlane({ previews: [PREVIEW] });
            await expect(logsCommand(argv("--preview", "old-quiz"), "shop")).rejects.toMatchObject({ code: 1 });
            expect(stderr.join("")).toContain("new-quiz");
        });

        it("follows a preview build and, when it fails, points at the preview's log", async () => {
            fakeControlPlane({
                previews: [PREVIEW],
                rows: {
                    [PREVIEW_DEPLOYMENTS_COLLECTION]: [
                        { id: "pd_9", status: "deploying", logs: "building\n" },
                        { id: "pd_9", status: "failed", logs: "building\n❌ Preview deploy failed: rollout timed out\n" }
                    ]
                }
            });

            const done = logsCommand(argv("--preview", "new-quiz", "-f"), "shop").catch((e: unknown) => e);
            await vi.advanceTimersByTimeAsync(10_000);

            expect(await done).toMatchObject({ code: 1 });
            const out = stdout.join("");
            expect(out).toContain("rebase cloud logs --preview new-quiz");
            expect(out).not.toContain("`rebase cloud logs`");
        });

        it("reads the preview's own pod for --runtime", async () => {
            const f = fakeControlPlane({ previews: [PREVIEW], pages: [page([line(1, "preview up", "rebase-preview-new-quiz-x")])] });

            await logsCommand(argv("--runtime", "--preview", "new-quiz"), "shop");

            expect(new URLSearchParams(runtimePaths(f)[0].split("?")[1]).get("preview")).toBe("new-quiz");
            expect(stdout.join("")).toContain("preview up");
            expect(stdout.join("")).toContain("preview new-quiz");
        });

        it("refuses to show production's log when the control plane ignores ?preview=", async () => {
            // An older control plane answers with production's pods and no echo.
            fakeControlPlane({ previews: [PREVIEW], pages: [page([line(1, "production line")], { preview: undefined })] });

            await expect(logsCommand(argv("--runtime", "--preview", "new-quiz"), "shop")).rejects.toMatchObject({ code: 1 });
            expect(stdout.join("")).not.toContain("production line");
            expect(stderr.join("")).toContain("cannot read a preview's runtime log");
        });

        it("reads the only preview when none is named, and asks which when there are several", async () => {
            context.setJsonModeForTest(true);
            fakeControlPlane({
                previews: [PREVIEW],
                rows: { [PREVIEW_DEPLOYMENTS_COLLECTION]: [{ id: "pd_9", status: "failed", logs: "x\n" }] }
            });
            await logsCommand(argv("--preview", "--json"), "shop");
            expect(JSON.parse(stdout.join(""))).toMatchObject({ preview: "new-quiz" });

            stdout = [];
            fakeControlPlane({ previews: [PREVIEW, { ...PREVIEW, name: "other", deploymentId: "pd_10" }] });
            await expect(logsCommand(argv("--preview", "--json"), "shop")).rejects.toMatchObject({ code: 1 });
            expect(JSON.parse(stdout.join(""))).toMatchObject({ error: { code: "usage" } });
            expect(stdout.join("")).toContain("--preview other");
        });

        it("refuses a bare name without --preview, rather than read production", async () => {
            fakeControlPlane({ previews: [PREVIEW] });
            await expect(logsCommand(argv("new-quiz"), "shop")).rejects.toMatchObject({ code: 1 });
            expect(stderr.join("")).toContain("--preview new-quiz");
        });

        it("says a static preview has no runtime log", async () => {
            const f = fakeControlPlane({ previews: [{ ...PREVIEW, name: "web-try", backend: "production" }] });
            await expect(logsCommand(argv("--runtime", "--preview", "web-try"), "shop")).rejects.toMatchObject({ code: 1 });
            expect(runtimePaths(f)).toHaveLength(0);
            expect(stderr.join("")).toContain("static app");
        });
    });
});
