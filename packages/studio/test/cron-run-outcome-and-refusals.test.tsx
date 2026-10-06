/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CronJobListing, CronJobLogEntry, CronJobStatus } from "@rebasepro/types";
import { translateEn } from "./en-translation";

/**
 * Two things the Cron Jobs panel said that the server had not.
 *
 * "Run Now" waits for the run to finish, and the answer carries how it went —
 * yet the toast was a green "Job triggered" whatever the log said, so a run
 * that threw read as one that worked.
 *
 * The listing names the cron files that did not load and the jobs the scheduler
 * refused, with the reason ("Expected 5 fields, got 6"). The panel read only
 * `jobs`, so a refused job was simply absent, and a project whose only job was
 * refused was told "No cron jobs registered — add a file under backend/crons/".
 */

const listJobs = jest.fn<() => Promise<CronJobListing>>();
const triggerJob = jest.fn<() => Promise<{ log: CronJobLogEntry; job: CronJobStatus }>>();
const getJobLogs = jest.fn<() => Promise<{ logs: CronJobLogEntry[] }>>();
const openSnackbar = jest.fn();

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t: translateEn, i18n: { language: "en" } }),
    useRebaseClient: () => ({ cron: { listJobs, triggerJob, getJobLogs, toggleJob: jest.fn() } }),
    useSnackbarController: () => ({ open: openSnackbar })
}));

import { CronJobsView } from "../src/components/CronJobs/CronJobsView";

const nightly: CronJobStatus = {
    id: "nightly",
    name: "Nightly sync",
    schedule: "0 3 * * *",
    enabled: true,
    state: "idle",
    totalRuns: 3,
    totalFailures: 0
};

function runLog(overrides: Partial<CronJobLogEntry>): CronJobLogEntry {
    return {
        jobId: "nightly",
        startedAt: "2026-10-06T03:00:00.000Z",
        finishedAt: "2026-10-06T03:00:02.000Z",
        durationMs: 2000,
        success: true,
        logs: [],
        manual: true,
        ...overrides
    };
}

beforeEach(() => {
    [listJobs, triggerJob, getJobLogs, openSnackbar].forEach(mock => mock.mockReset());
    getJobLogs.mockResolvedValue({ logs: [] });
});

async function runNow() {
    listJobs.mockResolvedValue({ jobs: [nightly] });
    render(<CronJobsView/>);
    fireEvent.click(await screen.findByText("Nightly sync"));
    fireEvent.click(await screen.findByText("Run Now"));
    await waitFor(() => expect(openSnackbar).toHaveBeenCalled());
}

describe("Run Now", () => {
    it("says a run that failed failed, with its error", async () => {
        triggerJob.mockResolvedValue({ log: runLog({ success: false, error: "upstream 502" }), job: nightly });

        await runNow();

        expect(openSnackbar).toHaveBeenCalledWith(expect.objectContaining({
            type: "error",
            message: expect.stringContaining("upstream 502")
        }));
        expect(openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
    });

    it("says a run that worked finished", async () => {
        triggerJob.mockResolvedValue({ log: runLog({ success: true }), job: nightly });

        await runNow();

        expect(openSnackbar).toHaveBeenCalledWith({
            type: "success",
            message: translateEn("studio_cron_run_succeeded", { job: "Nightly sync" })
        });
    });
});

describe("cron files and jobs that did not become jobs", () => {
    const refused = {
        id: "backup",
        name: "Scheduled database backup",
        schedule: "0 0 3 * * *",
        reason: "Expected 5 fields, got 6"
    };

    it("names a refused job and its reason instead of saying none are registered", async () => {
        listJobs.mockResolvedValue({
            jobs: [],
            skipped: 2,
            rejected: [refused],
            note: "1 cron file(s) failed to load and 1 job(s) were refused — NOT scheduled."
        });
        render(<CronJobsView/>);

        expect(await screen.findByText(/Expected 5 fields, got 6/)).toBeTruthy();
        expect(screen.getByText(translateEn("studio_cron_job_refused", { job: "Scheduled database backup" }))).toBeTruthy();
        // One of the two skipped is the refused job; the other is a file.
        expect(screen.getByText(translateEn("studio_cron_files_failed", { count: 1 }))).toBeTruthy();
        expect(screen.queryByText(en.studio_cron_empty_title!)).toBeNull();
    });

    it("shows a refused job beside the ones that are registered", async () => {
        listJobs.mockResolvedValue({ jobs: [nightly], skipped: 1, rejected: [refused] });
        render(<CronJobsView/>);

        expect(await screen.findByText("Nightly sync")).toBeTruthy();
        expect(screen.getByText(/Expected 5 fields, got 6/)).toBeTruthy();
        expect(screen.queryByText(translateEn("studio_cron_files_failed", { count: 1 }))).toBeNull();
    });

    it("still says none are registered when none are, and nothing was dropped", async () => {
        listJobs.mockResolvedValue({ jobs: [] });
        render(<CronJobsView/>);

        expect(await screen.findByText(en.studio_cron_empty_title!)).toBeTruthy();
    });
});
