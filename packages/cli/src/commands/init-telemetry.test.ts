import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import inquirer from "inquirer";

/**
 * The wiring, end to end.
 *
 * `telemetry/*.test.ts` proves `recordEvent` refuses without consent. That is
 * the guarantee, but it is a guarantee about a function — it says nothing about
 * whether `rebase init` calls the prompt before the sender, or whether a `--yes`
 * run reaches either.
 *
 * So this drives the real `createRebaseApp` into a temporary directory with the
 * network mocked, and asserts on what crossed it. Not a simulation of the
 * scaffold: the actual command, doing actual work.
 *
 * Dependency installation, git and cloud linking are all off, so nothing is
 * spawned and nothing is fetched but the calls under test — which is also what
 * keeps it from being flaky.
 */

let home: string;
let workdir: string;
let previousHome: string | undefined;
let previousCwd: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-home-"));
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-work-"));
    previousHome = process.env.HOME;
    previousCwd = process.cwd();
    process.env.HOME = home;
    vi.spyOn(os, "homedir").mockReturnValue(home);
    process.chdir(workdir);

    delete process.env.DO_NOT_TRACK;
    delete process.env.REBASE_TELEMETRY_DISABLED;
    delete process.env.CI;

    fetchMock = vi.fn().mockResolvedValue({ ok: true,
status: 204 });
    (global as any).fetch = fetchMock;

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.resetModules();
});

afterEach(() => {
    process.chdir(previousCwd);
    vi.restoreAllMocks();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(home, { recursive: true,
force: true });
    fs.rmSync(workdir, { recursive: true,
force: true });
});

/** A fully non-interactive scaffold: no install, no git, no cloud link. */
async function runInit(name = "my-app") {
    const { createRebaseApp } = await import("./init");
    await createRebaseApp(["node", "rebase", "init", name, "--yes", "--template", "blank"]);
    return path.join(workdir, name);
}

describe("rebase init — telemetry wiring", () => {

    it("sends nothing on a --yes run, and asks nothing", async () => {
        // The CI-safety property claimed in the commit message. `--yes` is what
        // every pipeline uses, so a prompt or a beacon here would fire on every
        // build in the world.
        const promptSpy = vi.spyOn(inquirer, "prompt");

        const projectDir = await runInit();

        expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
        expect(promptSpy).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    }, 60_000);

    it("writes no telemetry config on a --yes run", async () => {
        // Not merely "sent nothing" — nothing was recorded either, so the next
        // interactive run still gets to ask.
        const { configPath } = await import("../telemetry");
        await runInit();
        expect(fs.existsSync(configPath())).toBe(false);
    }, 60_000);

    it("sends the init event once the developer accepts", async () => {
        // The other half: the prompt is reached, and accepting actually reports.
        Object.defineProperty(process.stdin, "isTTY", { value: true,
configurable: true });
        vi.spyOn(inquirer, "prompt").mockImplementation(
            (async (questions: unknown) => {
                const list = questions as Array<{ name: string }>;
                // Only the consent question is answered here; everything else is
                // supplied by --yes, so anything else arriving is a test bug.
                if (list[0]?.name === "accepted") return { accepted: true };
                throw new Error(`unexpected prompt: ${list[0]?.name}`);
            }) as never
        );

        await runInit("accepted-app");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(/\/telemetry$/);

        const body = JSON.parse(init.body);
        expect(body.event).toBe("cli.init");
        expect(body.properties.preset).toBe("blank");
        expect(body.properties.installed_deps).toBe(false);
        // The scaffold created `.rebase/`, so the checkout is identified too —
        // this is what makes init → dev → deploy a funnel.
        expect(body.projectId).toMatch(/^[0-9a-f-]{36}$/);
    }, 60_000);

    it("sends nothing when the developer declines at the prompt", async () => {
        Object.defineProperty(process.stdin, "isTTY", { value: true,
configurable: true });
        vi.spyOn(inquirer, "prompt").mockResolvedValue({ accepted: false } as never);

        await runInit("declined-app");

        expect(fetchMock).not.toHaveBeenCalled();
    }, 60_000);

    it("carries no path, project name or home directory in what it sends", async () => {
        // The scaffold knows the project's name and its absolute path. Neither
        // may reach the payload — the second one contains the developer's name.
        Object.defineProperty(process.stdin, "isTTY", { value: true,
configurable: true });
        vi.spyOn(inquirer, "prompt").mockResolvedValue({ accepted: true } as never);

        await runInit("acme-internal-billing");

        const body = fetchMock.mock.calls[0][1].body as string;
        expect(body).not.toMatch(/acme-internal-billing/);
        expect(body).not.toMatch(/\/Users\/|\/home\/|C:\\/);
        expect(body).not.toContain(workdir);
    }, 60_000);
});
