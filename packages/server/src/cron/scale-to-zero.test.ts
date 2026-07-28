import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
    detectFreezableRuntime,
    buildScaleToZeroWarning,
    CRON_ALWAYS_ON_ENV,
    type EnvLike
} from "./scale-to-zero";
import { CronScheduler } from "./cron-scheduler";
import { logger } from "../utils/logger";
import type { CronJobDefinition } from "@rebasepro/types";
import type { LoadedCronJob } from "./cron-loader";

// ─── Helpers ────────────────────────────────────────────────────────

function makeJob(id: string, overrides: Partial<CronJobDefinition> = {}): LoadedCronJob {
    return {
        id,
        definition: {
            schedule: "0 * * * *",
            name: `Job ${id}`,
            enabled: true,
            timeoutSeconds: 5,
            handler: async () => ({ ok: true }),
            ...overrides
        }
    };
}

/** Cloud Run service, production. */
const CLOUD_RUN: EnvLike = {
    NODE_ENV: "production",
    K_SERVICE: "my-api",
    K_REVISION: "my-api-00007-abc",
    K_CONFIGURATION: "my-api"
};

/** GKE pod running the same image (app.rebase.pro shape). */
const GKE: EnvLike = {
    NODE_ENV: "production",
    KUBERNETES_SERVICE_HOST: "10.0.0.1",
    KUBERNETES_SERVICE_PORT: "443"
};

// ─── detectFreezableRuntime ─────────────────────────────────────────

describe("detectFreezableRuntime", () => {
    it("detects a Cloud Run service and reports the signals it matched", () => {
        expect(detectFreezableRuntime(CLOUD_RUN)).toEqual({
            platform: "Cloud Run",
            signals: ["K_SERVICE", "K_REVISION", "K_CONFIGURATION"]
        });
    });

    it("detects Cloud Run with only K_SERVICE present", () => {
        expect(detectFreezableRuntime({ K_SERVICE: "svc" })).toEqual({
            platform: "Cloud Run",
            signals: ["K_SERVICE"]
        });
    });

    it("detects Cloud Run Jobs, AWS Lambda and Vercel", () => {
        expect(detectFreezableRuntime({ CLOUD_RUN_JOB: "nightly" })?.platform).toBe("Cloud Run Jobs");
        expect(detectFreezableRuntime({ AWS_LAMBDA_FUNCTION_NAME: "api" })?.platform).toBe("AWS Lambda");
        expect(detectFreezableRuntime({ VERCEL: "1" })?.platform).toBe("Vercel");
    });

    it("does not treat a Kubernetes pod as freezable", () => {
        expect(detectFreezableRuntime(GKE)).toBeUndefined();
    });

    it("does not fire on Knative-on-Kubernetes, where K_SERVICE is set inside a pod", () => {
        expect(detectFreezableRuntime({
            ...CLOUD_RUN,
            KUBERNETES_SERVICE_HOST: "10.0.0.1"
        })).toBeUndefined();
    });

    it("returns undefined for a bare / unknown environment", () => {
        expect(detectFreezableRuntime({})).toBeUndefined();
        expect(detectFreezableRuntime({ NODE_ENV: "production", PORT: "8080" })).toBeUndefined();
    });

    it("ignores VERCEL values other than \"1\"", () => {
        expect(detectFreezableRuntime({ VERCEL: "0" })).toBeUndefined();
    });
});

// ─── buildScaleToZeroWarning ────────────────────────────────────────

describe("buildScaleToZeroWarning", () => {
    const enabledJob = { id: "nightly-report", enabled: true };

    it("warns on Cloud Run in production with an enabled job", () => {
        const warning = buildScaleToZeroWarning([enabledJob], CLOUD_RUN);
        expect(warning).toBeDefined();
        expect(warning!.message).toContain("[cron] Cloud Run detected");
        expect(warning!.message).toContain("nightly-report");
        expect(warning!.message).toContain("POST /api/cron/:id/trigger");
        expect(warning!.message).toContain(`${CRON_ALWAYS_ON_ENV}=1`);
        expect(warning!.data).toEqual({
            platform: "Cloud Run",
            signals: ["K_SERVICE", "K_REVISION", "K_CONFIGURATION"],
            jobs: ["nightly-report"]
        });
    });

    it("does not warn on GKE", () => {
        expect(buildScaleToZeroWarning([enabledJob], GKE)).toBeUndefined();
    });

    it("does not warn outside production", () => {
        expect(buildScaleToZeroWarning([enabledJob], { ...CLOUD_RUN, NODE_ENV: "development" })).toBeUndefined();
        expect(buildScaleToZeroWarning([enabledJob], { ...CLOUD_RUN, NODE_ENV: "test" })).toBeUndefined();
        expect(buildScaleToZeroWarning([enabledJob], { ...CLOUD_RUN, NODE_ENV: undefined })).toBeUndefined();
    });

    it("does not warn when no job is enabled", () => {
        expect(buildScaleToZeroWarning([], CLOUD_RUN)).toBeUndefined();
        expect(buildScaleToZeroWarning([{ id: "off", enabled: false }], CLOUD_RUN)).toBeUndefined();
    });

    it("names only the enabled jobs", () => {
        const warning = buildScaleToZeroWarning([
            { id: "on-1", enabled: true },
            { id: "off-1", enabled: false },
            { id: "on-2", enabled: true }
        ], CLOUD_RUN);
        expect(warning!.data.jobs).toEqual(["on-1", "on-2"]);
        expect(warning!.message).toContain("2 enabled job(s)");
        expect(warning!.message).not.toContain("off-1");
    });

    it("collapses a long job list", () => {
        const jobs = Array.from({ length: 13 }, (_, i) => ({ id: `job-${i}`, enabled: true }));
        const warning = buildScaleToZeroWarning(jobs, CLOUD_RUN);
        expect(warning!.message).toContain("13 enabled job(s)");
        expect(warning!.message).toContain("(+3 more)");
        expect(warning!.message).not.toContain("job-12");
    });

    it.each(["1", "true", "TRUE", "yes", "on", " 1 "])(
        "is silenced by %s opt-out value",
        (value) => {
            expect(buildScaleToZeroWarning([enabledJob], { ...CLOUD_RUN, [CRON_ALWAYS_ON_ENV]: value })).toBeUndefined();
        }
    );

    it.each(["", "0", "false", "no"])("is not silenced by %s opt-out value", (value) => {
        expect(buildScaleToZeroWarning([enabledJob], { ...CLOUD_RUN, [CRON_ALWAYS_ON_ENV]: value })).toBeDefined();
    });
});

// ─── CronScheduler.start() integration ──────────────────────────────

describe("CronScheduler scale-to-zero warning at start()", () => {
    let scheduler: CronScheduler;
    const warned: string[] = [];
    const originalEnv = { ...process.env };

    /** Warnings emitted by the scale-to-zero check only. */
    function scaleToZeroWarnings(): string[] {
        return warned.filter((msg) => msg.includes("in-process timers"));
    }

    function setEnv(env: EnvLike): void {
        for (const key of ["NODE_ENV", "K_SERVICE", "K_REVISION", "K_CONFIGURATION",
            "KUBERNETES_SERVICE_HOST", "KUBERNETES_SERVICE_PORT", "CLOUD_RUN_JOB",
            "AWS_LAMBDA_FUNCTION_NAME", "VERCEL", CRON_ALWAYS_ON_ENV]) {
            delete process.env[key];
        }
        for (const [key, value] of Object.entries(env)) {
            if (value !== undefined) process.env[key] = value;
        }
    }

    beforeEach(() => {
        scheduler = new CronScheduler();
        jest.useFakeTimers();
        warned.length = 0;
        jest.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        jest.spyOn(logger, "info").mockImplementation(() => { /* silence boot noise */ });
    });

    afterEach(() => {
        scheduler.stop();
        jest.useRealTimers();
        jest.restoreAllMocks();
        process.env = { ...originalEnv };
    });

    it("warns on Cloud Run in production and still starts", () => {
        setEnv(CLOUD_RUN);
        scheduler.registerJobs([makeJob("nightly")]);
        expect(() => scheduler.start()).not.toThrow();

        const warnings = scaleToZeroWarnings();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("Cloud Run detected");
        expect(warnings[0]).toContain("nightly");
        // Boot continued: the job is scheduled as usual.
        expect(scheduler.listJobs()[0].nextRunAt).toBeDefined();
    });

    it("does not warn on GKE and still starts", () => {
        setEnv(GKE);
        scheduler.registerJobs([makeJob("nightly")]);
        expect(() => scheduler.start()).not.toThrow();
        expect(scaleToZeroWarnings()).toEqual([]);
        expect(scheduler.listJobs()[0].nextRunAt).toBeDefined();
    });

    it("does not warn in development and still starts", () => {
        setEnv({ ...CLOUD_RUN, NODE_ENV: "development" });
        scheduler.registerJobs([makeJob("nightly")]);
        expect(() => scheduler.start()).not.toThrow();
        expect(scaleToZeroWarnings()).toEqual([]);
        expect(scheduler.listJobs()[0].nextRunAt).toBeDefined();
    });

    it("does not warn when every job is disabled and still starts", () => {
        setEnv(CLOUD_RUN);
        scheduler.registerJobs([makeJob("off", { enabled: false })]);
        expect(() => scheduler.start()).not.toThrow();
        expect(scaleToZeroWarnings()).toEqual([]);
        expect(scheduler.listJobs()).toHaveLength(1);
    });

    it("does not warn when no job is registered at all and still starts", () => {
        setEnv(CLOUD_RUN);
        expect(() => scheduler.start()).not.toThrow();
        expect(scaleToZeroWarnings()).toEqual([]);
    });

    it("is silenced by the opt-out and still starts", () => {
        setEnv({ ...CLOUD_RUN, [CRON_ALWAYS_ON_ENV]: "1" });
        scheduler.registerJobs([makeJob("nightly")]);
        expect(() => scheduler.start()).not.toThrow();
        expect(scaleToZeroWarnings()).toEqual([]);
        expect(scheduler.listJobs()[0].nextRunAt).toBeDefined();
    });

    it("still boots when the warning itself blows up", () => {
        setEnv(CLOUD_RUN);
        jest.spyOn(logger, "warn").mockImplementation((message: string) => {
            if (message.includes("in-process timers")) throw new Error("logger exploded");
            warned.push(message);
        });
        scheduler.registerJobs([makeJob("nightly")]);
        expect(() => scheduler.start()).not.toThrow();
        expect(scheduler.listJobs()[0].nextRunAt).toBeDefined();
    });
});
