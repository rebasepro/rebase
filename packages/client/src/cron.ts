import { Transport } from "./transport";
import type { CronJobStatus, CronJobLogEntry, CronJobListing, CronJobStarted } from "@rebasepro/types";

export interface CreateCronOptions {
    cronPath?: string;
}

export function createCron(transport: Transport, options?: CreateCronOptions) {
    const cronPath = options?.cronPath || "/admin/cron";

    async function listJobs(): Promise<CronJobListing> {
        return transport.request<CronJobListing>(cronPath, { method: "GET" });
    }

    async function getJob(jobId: string): Promise<{ job: CronJobStatus }> {
        return transport.request<{ job: CronJobStatus }>(
            cronPath + "/" + encodeURIComponent(jobId),
            { method: "GET" }
        );
    }

    /**
     * Run a job now. By default the call waits for the run and answers with
     * its log; `{ async: true }` answers once the run has started (`202`), for
     * jobs longer than a proxy in front of the server will hold a request.
     */
    function triggerJob(jobId: string, options?: { async?: false }): Promise<{ log: CronJobLogEntry; job: CronJobStatus }>;
    function triggerJob(jobId: string, options: { async: true }): Promise<CronJobStarted>;
    async function triggerJob(
        jobId: string,
        options?: { async?: boolean }
    ): Promise<{ log: CronJobLogEntry; job: CronJobStatus } | CronJobStarted> {
        const path = cronPath + "/" + encodeURIComponent(jobId) + "/trigger";
        if (options?.async) {
            return transport.request<CronJobStarted>(path + "?async=1", { method: "POST" });
        }
        return transport.request<{ log: CronJobLogEntry; job: CronJobStatus }>(path, { method: "POST" });
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
