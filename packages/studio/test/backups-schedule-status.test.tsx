/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * The panel says how the scheduled backup is doing.
 *
 * A backup cron that failed every night — the runtime image shipped no
 * `pg_dump` — left this panel empty under "wait for the next scheduled run",
 * forever, with the reason one panel away in the cron history. The listing
 * now carries the job's last run, and a failed one is an error here.
 */

const list = jest.fn<() => Promise<unknown>>();

function t(key: string, values?: Record<string, string>): string {
    const template = en[key as keyof typeof en] ?? key;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values?.[name] ?? "");
}

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t, i18n: { language: "en" } }),
    useRebaseClient: () => ({ backups: { list, download: jest.fn() } }),
    useSnackbarController: () => ({ open: jest.fn() })
}));

import { BackupsView } from "../src/components/Backups/BackupsView";

const PG_DUMP_MISSING = "Could not find the 'pg_dump' binary.";

describe("Backups panel and the scheduled run", () => {
    beforeEach(() => { list.mockReset(); });

    it("shows a failed last run and its error, even with no backups listed", async () => {
        list.mockResolvedValue({
            backups: [],
            destinationKind: "local",
            configured: true,
            schedule: {
                jobId: "backup",
                name: "Scheduled database backup",
                schedule: "0 3 * * *",
                enabled: true,
                lastRun: {
                    startedAt: "2026-09-30T03:00:00.000Z",
                    finishedAt: "2026-09-30T03:00:01.000Z",
                    success: false,
                    error: PG_DUMP_MISSING,
                    manual: false
                }
            }
        });
        render(<BackupsView/>);

        await waitFor(() => expect(screen.getByText(PG_DUMP_MISSING)).toBeTruthy());
        expect(screen.getByText(/^The last scheduled backup failed/)).toBeTruthy();
        // The old empty state told the reader to wait for a run that would fail again.
        expect(screen.queryByText(/wait for the next scheduled run/)).toBeNull();
        expect(screen.queryByText(en.studio_backups_empty_hint!)).toBeNull();
    });

    it("shows a successful last run and the next one as a quiet line", async () => {
        list.mockResolvedValue({
            backups: [],
            destinationKind: "local",
            configured: true,
            schedule: {
                jobId: "backup",
                name: "Scheduled database backup",
                schedule: "0 3 * * *",
                enabled: true,
                nextRunAt: "2026-10-01T03:00:00.000Z",
                lastRun: {
                    startedAt: "2026-09-30T03:00:00.000Z",
                    finishedAt: "2026-09-30T03:00:05.000Z",
                    success: true,
                    manual: false
                }
            }
        });
        render(<BackupsView/>);

        await waitFor(() => expect(screen.getByText(/^Last scheduled backup:/)).toBeTruthy());
        expect(screen.getByText(/Next run:/)).toBeTruthy();
        expect(screen.queryByText(/^The last scheduled backup failed/)).toBeNull();
    });

    it("says the run history could not be read, not that the backup has not run", async () => {
        // The cron_logs query failed. "The scheduled backup has not run yet"
        // would be a claim about a history nobody could read.
        list.mockResolvedValue({
            backups: [],
            destinationKind: "local",
            configured: true,
            schedule: {
                jobId: "backup",
                name: "Scheduled database backup",
                schedule: "0 3 * * *",
                enabled: true,
                nextRunAt: "2026-10-01T03:00:00.000Z",
                historyError: "The backup job's run history could not be read. The server log has the reason."
            }
        });
        render(<BackupsView/>);

        await waitFor(() => expect(screen.getByText(en.studio_backups_history_unreadable!)).toBeTruthy());
        expect(screen.queryByText(new RegExp(en.studio_backups_never_ran!))).toBeNull();
    });

    it("says the backup job was refused, and why, instead of that none exists", async () => {
        // A six-field BACKUP_SCHEDULE. The job never runs; the panel used to get
        // no schedule at all, and told the reader to add the cron file they have.
        list.mockResolvedValue({
            backups: [],
            destinationKind: "s3",
            configured: true,
            schedule: {
                jobId: "backup",
                name: "Scheduled database backup",
                schedule: "0 0 3 * * *",
                enabled: false,
                refused: "Expected 5 fields, got 6"
            }
        });
        render(<BackupsView/>);

        await waitFor(() => expect(screen.getByText(/Expected 5 fields, got 6/)).toBeTruthy());
        expect(screen.getByText(t("studio_backups_job_refused", { job: "backup" }))).toBeTruthy();
        expect(screen.queryByText(/^Scheduled backups are paused/)).toBeNull();
        expect(screen.queryByText(en.studio_backups_empty_hint!)).toBeNull();
    });

    it("says a paused schedule is paused", async () => {
        list.mockResolvedValue({
            backups: [],
            destinationKind: "local",
            configured: true,
            schedule: { jobId: "nightly", name: "Nightly", schedule: "0 3 * * *", enabled: false }
        });
        render(<BackupsView/>);

        await waitFor(() => expect(screen.getByText(/^Scheduled backups are paused\. Resume the nightly job/)).toBeTruthy());
    });

    it("with no schedule, says how to take or schedule a backup — in the reader's language", async () => {
        // An older server sends no `schedule` at all.
        list.mockResolvedValue({ backups: [], destinationKind: "local", configured: true });
        render(<BackupsView/>);

        await waitFor(() => expect(screen.getByText(en.studio_backups_empty!)).toBeTruthy());
        expect(screen.getByText(en.studio_backups_empty_hint!)).toBeTruthy();
    });
});
