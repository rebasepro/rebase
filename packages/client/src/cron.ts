import { Transport } from "./transport";
import type { CronJobStatus, CronJobLogEntry } from "@rebasepro/types";

export interface CreateCronOptions {
    cronPath?: string;
}

export function createCron(transport: Transport, options?: CreateCronOptions) {
    const cronPath = options?.cronPath || "/cron";

    async function listJobs(): Promise<{ jobs: CronJobStatus[] }> {
        return transport.request<{ jobs: CronJobStatus[] }>(cronPath, { method: "GET" });
    }

    async function getJob(jobId: string): Promise<{ job: CronJobStatus }> {
        return transport.request<{ job: CronJobStatus }>(
            cronPath + "/" + encodeURIComponent(jobId),
            { method: "GET" }
        );
    }

    async function triggerJob(jobId: string): Promise<{ log: CronJobLogEntry; job: CronJobStatus }> {
        return transport.request<{ log: CronJobLogEntry; job: CronJobStatus }>(
            cronPath + "/" + encodeURIComponent(jobId) + "/trigger",
            { method: "POST" }
        );
    }

    async function getJobLogs(
        jobId: string,
        options?: { limit?: number }
    ): Promise<{ logs: CronJobLogEntry[] }> {
        const params = new URLSearchParams();
        if (options?.limit !== undefined) params.set("limit", String(options.limit));
        const qs = params.toString();
        return transport.request<{ logs: CronJobLogEntry[] }>(
            cronPath + "/" + encodeURIComponent(jobId) + "/logs" + (qs ? "?" + qs : ""),
            { method: "GET" }
        );
    }

    async function toggleJob(
        jobId: string,
        enabled: boolean
    ): Promise<{ job: CronJobStatus }> {
        return transport.request<{ job: CronJobStatus }>(
            cronPath + "/" + encodeURIComponent(jobId),
            {
                method: "PUT",
                body: JSON.stringify({ enabled })
            }
        );
    }

    return {
        listJobs,
        getJob,
        triggerJob,
        getJobLogs,
        toggleJob
    };
}
