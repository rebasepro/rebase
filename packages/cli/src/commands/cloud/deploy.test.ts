/**
 * What a `rebase cloud deploy` with nothing attached is about to build.
 *
 * The bare form uploads nothing: it asks the control plane to rebuild the
 * source it already holds. Which source that is — a git checkout, a months-old
 * uploaded archive, or nothing at all — was never stated, so a deploy that
 * shipped stale code looked exactly like one that shipped the working tree. And
 * on a managed project a source build rewrites `runtimeMode` to `custom`
 * server-side, so the bare form silently ejected the project from the runtime it
 * was deliberately put on.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
    planBareDeploy,
    isManagedProject,
    timeAgo,
    deployWarnings,
    ejectRefusal,
    warningPayload,
    ejectWarning,
    resolveDeployTimeout,
    billingBlocksDeploy,
    EJECTS_MANAGED_RUNTIME
} from "./deploy";
import { warn, setJsonModeForTest } from "./context";

const NOW = new Date("2026-07-26T12:00:00.000Z");

describe("recognising a managed project", () => {
    it("trusts the project's runtimeMode", () => {
        expect(isManagedProject({ runtimeMode: "managed" }, undefined)).toBe(true);
        expect(isManagedProject({ runtime_mode: "managed" }, undefined)).toBe(true);
        expect(isManagedProject({ runtimeMode: "custom" }, undefined)).toBe(false);
    });

    it("falls back to a successful deploy that served a bundle", () => {
        // A control plane that does not return `runtimeMode` must not turn the
        // refusal off — only the managed path ever records a bundle id.
        expect(isManagedProject(undefined, { status: "success",
bundleId: "b1" })).toBe(true);
        expect(isManagedProject(undefined, { status: "success",
bundle_id: "b1" })).toBe(true);
    });

    it("does not read a failed bundle deploy as managed", () => {
        // The project is still on whatever was running before it failed.
        expect(isManagedProject(undefined, { status: "failed",
bundleId: "b1" })).toBe(false);
    });

    it("says no when it knows nothing", () => {
        expect(isManagedProject(undefined, undefined)).toBe(false);
        expect(isManagedProject({}, {})).toBe(false);
    });
});

describe("planning a bare deploy", () => {
    it("flags a managed project, whose source build would eject it", () => {
        expect(planBareDeploy({ runtimeMode: "managed" }, undefined, NOW).managed).toBe(true);
        expect(planBareDeploy({ runtimeMode: "custom" }, undefined, NOW).managed).toBe(false);
    });

    it("still says what a forced build would use, managed or not", () => {
        // `--force` deploys anyway, so the source has to be named either way.
        const plan = planBareDeploy(
            { runtimeMode: "managed",
gitRepoUrl: "https://github.com/acme/api.git" },
            undefined,
            NOW
        );
        expect(plan.managed).toBe(true);
        expect(plan.source).toBe("git");
    });

    it("names the repository a git build will clone", () => {
        const plan = planBareDeploy(
            { gitRepoUrl: "https://github.com/acme/api.git",
gitBranch: "main" },
            undefined,
            NOW
        );
        expect(plan.source).toBe("git");
        expect(plan.lines[0]).toContain("https://github.com/acme/api.git");
        expect(plan.lines[0]).toContain("main");
    });

    it("dates the stored archive, and says the working directory is not it", () => {
        const plan = planBareDeploy(
            {},
            { id: 42,
sourceRef: "gs://ctx/p/1.tar.gz",
createdAt: "2026-07-20T12:00:00.000Z" },
            NOW
        );
        expect(plan.source).toBe("snapshot");
        expect(plan.lines[0]).toContain("deployment 42");
        expect(plan.lines[0]).toContain("6d ago");
        expect(plan.lines.join(" ")).toContain("--source .");
    });

    it("reports having nothing to rebuild", () => {
        expect(planBareDeploy({}, { id: 1,
status: "failed" }, NOW).source).toBe("none");
        expect(planBareDeploy(undefined, undefined, NOW).source).toBe("none");
    });

    it("prefers git over an older uploaded archive", () => {
        // Both can be present: a project that was uploaded once and later had a
        // repository set. Git is what the control plane will actually build.
        const plan = planBareDeploy(
            { gitRepoUrl: "https://github.com/acme/api.git" },
            { id: 7,
sourceRef: "gs://ctx/p/1.tar.gz" },
            NOW
        );
        expect(plan.source).toBe("git");
    });
});

/*
 * The eject warning, and the output mode that used to swallow it.
 *
 * `--source` on a managed project ejects it to a custom container, and the only
 * thing that ever said so was a `console.log` behind `!isJsonMode()`. JSON mode
 * latches on whenever stdout is not a TTY, so piping the command, or running it
 * from CI or an agent, removed the warning entirely — and the deploy's JSON
 * carried no equivalent field. A live project flipped from managed to custom
 * and it was found later, from `rebase cloud status`.
 *
 * So: the decision to warn is tested independently of any output mode, and the
 * emitting is tested *in* JSON mode, which is the case nothing covered.
 */
describe("refusing to eject a managed project that did not ask to leave", () => {
    const ref = "acme-api";

    it("refuses --source without --force, which is how the incident happened", () => {
        // The whole point: `--source` answers "which source do I build", not
        // "take this project off the managed runtime".
        const r = ejectRefusal({ managed: true,
source: true,
force: false }, ref);
        expect(r?.code).toBe("managed_project");
        expect(r?.message).toContain(ref);
        expect(r?.hint).toContain("--bundle");
        expect(r?.hint).toContain("--force");
    });

    it("still refuses a bare deploy without --force", () => {
        expect(ejectRefusal({ managed: true,
source: false,
force: false }, ref)?.code).toBe("managed_project");
    });

    it("lets --force through, however the build was asked for", () => {
        // `--force` is the one flag that names the outcome, so it is the one
        // flag that buys it — for both forms, which is the point of the change.
        expect(ejectRefusal({ managed: true,
source: true,
force: true }, ref)).toBeUndefined();
        expect(ejectRefusal({ managed: true,
source: false,
force: true }, ref)).toBeUndefined();
    });

    it("never stands in the way of a project that is not managed", () => {
        for (const source of [true, false]) {
            for (const force of [true, false]) {
                expect(ejectRefusal({ managed: false,
source,
force }, ref)).toBeUndefined();
            }
        }
    });
});

describe("warning that a deploy ejects a managed project", () => {
    const ref = "acme-api";

    it("warns for every eject that gets past the refusal", () => {
        // Only forced builds reach this, and both spellings eject.
        for (const source of [true, false]) {
            const w = deployWarnings({ managed: true,
source,
force: true }, ref);
            expect(w.map((x) => x.code)).toEqual([EJECTS_MANAGED_RUNTIME]);
            expect(w[0].message).toContain(ref);
            expect(w[0].hint).toContain("--bundle");
        }
    });

    it("says nothing about a project that is not managed", () => {
        expect(deployWarnings({ managed: false,
source: true,
force: true }, ref)).toEqual([]);
        expect(deployWarnings({ managed: false,
source: false,
force: true }, ref)).toEqual([]);
    });

    it("puts the eject in the payload, as a flag CI can branch on", () => {
        const payload = warningPayload(deployWarnings({ managed: true,
source: true,
force: true }, ref));
        expect(payload.ejectsManagedRuntime).toBe(true);
        expect(payload.warnings).toHaveLength(1);
        expect((payload.warnings as Array<{ code: string }>)[0].code).toBe(EJECTS_MANAGED_RUNTIME);
    });

    it("still carries the fields when there is nothing to warn about", () => {
        // A consumer reading `.ejectsManagedRuntime` must not have to tell
        // `false` from absent, so both fields are always present.
        const payload = warningPayload([]);
        expect(payload.ejectsManagedRuntime).toBe(false);
        expect(payload.warnings).toEqual([]);
    });
});

describe("emitting a warning in JSON mode", () => {
    afterEach(() => {
        setJsonModeForTest(false);
        vi.restoreAllMocks();
    });

    /** Capture both streams; JSON mode reserves stdout for the result value. */
    function captureStreams() {
        const err: string[] = [];
        const out: string[] = [];
        vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => (err.push(String(c)), true));
        vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => (out.push(String(c)), true));
        // console.error/log go through the streams above, but vitest may have
        // its own console — spy on both so nothing escapes the capture.
        vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ") + "\n"));
        vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ") + "\n"));
        return { err: () => err.join(""),
out: () => out.join("") };
    }

    it("emits the warning even when stdout is not a TTY", () => {
        // The regression, exactly: the mode is on, and the warning must survive.
        setJsonModeForTest(true);
        const { err, out } = captureStreams();
        const w = ejectWarning("acme-api");
        warn(w.message, w.hint);
        expect(err()).toContain("acme-api");
        expect(err()).toContain("managed runtime");
        expect(out()).toBe("");
    });

    it("keeps the JSON stream clean — warnings are stderr, never stdout", () => {
        setJsonModeForTest(true);
        const { out } = captureStreams();
        warn("something worth saying", "and a hint");
        expect(out()).toBe("");
    });

    it("writes to stderr in human mode too, differing only in formatting", () => {
        setJsonModeForTest(false);
        const { err, out } = captureStreams();
        warn("something worth saying", "and a hint");
        expect(err()).toContain("something worth saying");
        expect(err()).toContain("and a hint");
        expect(out()).toBe("");
    });
});

describe("timeAgo", () => {
    it("scales from minutes to days", () => {
        expect(timeAgo("2026-07-26T11:59:40.000Z", NOW)).toBe("just now");
        expect(timeAgo("2026-07-26T11:25:00.000Z", NOW)).toBe("35m ago");
        expect(timeAgo("2026-07-26T04:00:00.000Z", NOW)).toBe("8h ago");
        expect(timeAgo("2026-07-01T12:00:00.000Z", NOW)).toBe("25d ago");
    });

    it("says nothing rather than something wrong", () => {
        expect(timeAgo(undefined, NOW)).toBeUndefined();
        expect(timeAgo("not a date", NOW)).toBeUndefined();
        // A row stamped in the future is skew, not an age.
        expect(timeAgo("2026-08-01T12:00:00.000Z", NOW)).toBeUndefined();
    });
});

/**
 * `--timeout <seconds>`.
 *
 * The value bounds a wait that a caller has its own deadline for, so a value
 * this cannot read is refused rather than replaced with the default. Silently
 * substituting fifteen minutes for a misspelled `--timeout 30s` is how a wait
 * outlives the job that asked for it.
 */
describe("resolveDeployTimeout", () => {
    afterEach(() => {
        setJsonModeForTest(false);
        vi.restoreAllMocks();
    });

    it("defaults to the 15-minute ceiling", () => {
        expect(resolveDeployTimeout(undefined)).toBe(15 * 60 * 1000);
    });

    it("reads seconds", () => {
        expect(resolveDeployTimeout("300")).toBe(300_000);
    });

    it.each([["0"], ["-5"], ["30s"], ["soon"]])("refuses %s", (value) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);
        expect(() => resolveDeployTimeout(value)).toThrow("__exit__");
        exit.mockRestore();
    });
});

/**
 * The billing pre-check, which only ever refuses in one direction.
 *
 * The 402 used to land after a completed upload: the managed path builds, packs
 * and uploads before it triggers anything, so "no card on file" arrived at the
 * end of several minutes whose only product was a discarded tarball. Moving the
 * question earlier is only safe if the client refuses exactly when it is sure —
 * an internal billing account and `REBASE_BYO_FREE` are both server-side skips
 * this client cannot see, so every unknown has to proceed and let the server
 * decide.
 */
describe("billingBlocksDeploy", () => {
    it("refuses when the control plane says there is no card", () => {
        expect(billingBlocksDeploy({ plan: "standard",
hasPaymentMethod: false,
simulated: false })).toBe(true);
    });

    it("lets a card on file through", () => {
        expect(billingBlocksDeploy({ plan: "standard",
hasPaymentMethod: true,
simulated: false })).toBe(false);
    });

    it("never refuses on an answer it could not get", () => {
        expect(billingBlocksDeploy({ plan: null,
hasPaymentMethod: null,
simulated: false })).toBe(false);
    });

    it("exempts a control plane with no Stripe behind it", () => {
        // `hasPaymentMethod: false` there is inferred from a simulated setup,
        // not from a customer that has no card.
        expect(billingBlocksDeploy({ plan: null,
hasPaymentMethod: false,
simulated: true })).toBe(false);
    });

    it("exempts an internal billing account, which the server skips entirely", () => {
        expect(billingBlocksDeploy({ plan: "internal",
hasPaymentMethod: false,
simulated: false })).toBe(false);
    });
});
