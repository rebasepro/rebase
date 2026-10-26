/**
 * `rebase cloud claim`: the stored claim link, the time left, and a clean
 * refusal once the project has been claimed or its window has ended.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        readLink: vi.fn(),
        storedGrantForLink: vi.fn(),
        probeToken: vi.fn(),
        forgetEphemeralGrant: vi.fn(),
        openUrl: vi.fn(),
        projectDotenvSetsAppKey: vi.fn(() => false)
    };
});

import * as context from "./context";
import { claimCommand, timeLeft, CLAIM_FLAGS } from "./claim";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const GRANT = {
    token: "rpt_project_token",
    claimUrl: `https://app.rebase.pro/claim/rcl_${"a".repeat(48)}`,
    expiresAt: "2026-10-26T05:00:00.000Z"
};
const LINK = { projectId: "proj_eph", slug: "todo-k3j9", url: "https://cp.example", mode: "cloud" };
const argv = (...rest: string[]) => ["node", "rebase", "cloud", "claim", ...rest, "--json"];

function mocked<T>(fn: T) {
    return fn as unknown as ReturnType<typeof vi.fn>;
}

async function run(...rest: string[]): Promise<{ out: Record<string, unknown>; exited: boolean }> {
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => {
        chunks.push(String(s));
        return true;
    }) as typeof process.stdout.write;
    const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
        throw new Error("__exit__");
    }) as never);
    let exited = false;
    try {
        await claimCommand(argv(...rest), () => NOW);
    } catch (e) {
        if ((e as Error).message !== "__exit__") throw e;
        exited = true;
    } finally {
        process.stdout.write = write;
        exit.mockRestore();
    }
    return { out: JSON.parse(chunks.join("").trim()), exited };
}

beforeEach(() => {
    context.setJsonModeForTest(true);
    mocked(context.readLink).mockReturnValue(LINK);
    mocked(context.storedGrantForLink).mockReturnValue({ url: "https://cp.example", grant: GRANT });
    mocked(context.probeToken).mockResolvedValue("accepted");
});
afterEach(() => {
    context.setJsonModeForTest(false);
    vi.clearAllMocks();
});

describe("rebase cloud claim", () => {
    it("prints the stored claim link and its expiry once the control plane accepts the project's token", async () => {
        const { out, exited } = await run();
        expect(exited).toBe(false);
        expect(out).toMatchObject({
            projectId: "proj_eph",
            claimUrl: GRANT.claimUrl,
            expiresAt: GRANT.expiresAt,
            verified: true,
            opened: false
        });
        expect(context.probeToken).toHaveBeenCalledWith("https://cp.example", GRANT.token);
        expect(context.openUrl).not.toHaveBeenCalled();
    });

    it("opens the link with --open", async () => {
        const { out } = await run("--open");
        expect(out.opened).toBe(true);
        expect(context.openUrl).toHaveBeenCalledWith(GRANT.claimUrl, expect.any(String));
    });

    it("refuses once the project has been claimed, and forgets the dead token", async () => {
        mocked(context.probeToken).mockResolvedValue("refused");
        const { out, exited } = await run("--open");
        expect(exited).toBe(true);
        expect(out).toMatchObject({ error: { code: "already_claimed" } });
        expect(JSON.stringify(out)).not.toContain(GRANT.claimUrl);
        expect(context.forgetEphemeralGrant).toHaveBeenCalledWith("https://cp.example", "proj_eph");
        expect(context.openUrl).not.toHaveBeenCalled();
    });

    it("still prints the link when the control plane cannot be asked, marked unverified", async () => {
        mocked(context.probeToken).mockResolvedValue("unknown");
        const { out, exited } = await run();
        expect(exited).toBe(false);
        expect(out).toMatchObject({ claimUrl: GRANT.claimUrl, verified: false });
        expect(context.forgetEphemeralGrant).not.toHaveBeenCalled();
    });

    it("says the window ended rather than printing an expired link", async () => {
        mocked(context.storedGrantForLink).mockReturnValue({
            url: "https://cp.example",
            grant: { ...GRANT, expiresAt: "2026-10-24T11:00:00.000Z" }
        });
        const { out, exited } = await run();
        expect(exited).toBe(true);
        expect(out).toMatchObject({ error: { code: "claim_expired" } });
        expect(context.probeToken).not.toHaveBeenCalled();
    });

    it("says there is no claim link here for a project with none stored", async () => {
        mocked(context.storedGrantForLink).mockReturnValue(undefined);
        const { out } = await run();
        expect(out).toMatchObject({ error: { code: "no_claim_link" } });
    });

    it("refuses in a directory that is not linked to a cloud project", async () => {
        mocked(context.readLink).mockReturnValue(null);
        const { out } = await run();
        expect(out).toMatchObject({ error: { code: "no_project" } });
        mocked(context.readLink).mockReturnValue({ ...LINK, mode: "direct" });
        expect((await run()).out).toMatchObject({ error: { code: "no_project" } });
    });

    it("refuses a flag it does not take", async () => {
        const { out } = await run("--opne");
        expect(out).toMatchObject({ error: { code: "usage" } });
        expect(Object.keys(CLAIM_FLAGS)).toEqual(["--open"]);
    });
});

describe("timeLeft", () => {
    it("reads hours past two, minutes below", () => {
        expect(timeLeft("2026-10-26T05:00:00.000Z", NOW)).toBe("41h");
        expect(timeLeft("2026-10-24T12:25:00.000Z", NOW)).toBe("25m");
        expect(timeLeft("2026-10-24T12:00:30.000Z", NOW)).toBe("under a minute");
        expect(timeLeft("2026-10-24T11:00:00.000Z", NOW)).toBe("no time");
    });
});
