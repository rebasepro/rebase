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
import { describe, it, expect } from "vitest";
import { planBareDeploy, isManagedProject, timeAgo } from "./deploy";

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
        expect(isManagedProject(undefined, { status: "success", bundleId: "b1" })).toBe(true);
        expect(isManagedProject(undefined, { status: "success", bundle_id: "b1" })).toBe(true);
    });

    it("does not read a failed bundle deploy as managed", () => {
        // The project is still on whatever was running before it failed.
        expect(isManagedProject(undefined, { status: "failed", bundleId: "b1" })).toBe(false);
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
            { runtimeMode: "managed", gitRepoUrl: "https://github.com/acme/api.git" },
            undefined,
            NOW
        );
        expect(plan.managed).toBe(true);
        expect(plan.source).toBe("git");
    });

    it("names the repository a git build will clone", () => {
        const plan = planBareDeploy(
            { gitRepoUrl: "https://github.com/acme/api.git", gitBranch: "main" },
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
            { id: 42, sourceRef: "gs://ctx/p/1.tar.gz", createdAt: "2026-07-20T12:00:00.000Z" },
            NOW
        );
        expect(plan.source).toBe("snapshot");
        expect(plan.lines[0]).toContain("deployment 42");
        expect(plan.lines[0]).toContain("6d ago");
        expect(plan.lines.join(" ")).toContain("--source .");
    });

    it("reports having nothing to rebuild", () => {
        expect(planBareDeploy({}, { id: 1, status: "failed" }, NOW).source).toBe("none");
        expect(planBareDeploy(undefined, undefined, NOW).source).toBe("none");
    });

    it("prefers git over an older uploaded archive", () => {
        // Both can be present: a project that was uploaded once and later had a
        // repository set. Git is what the control plane will actually build.
        const plan = planBareDeploy(
            { gitRepoUrl: "https://github.com/acme/api.git" },
            { id: 7, sourceRef: "gs://ctx/p/1.tar.gz" },
            NOW
        );
        expect(plan.source).toBe("git");
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
