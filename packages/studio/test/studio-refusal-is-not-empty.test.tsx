/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Four Studio panes caught a failed listing, opened a snackbar, and left their
 * list empty. Four seconds later the toast was gone and the screen said "No
 * backups found yet", "No Cron Jobs Registered", "No API keys yet", "No
 * branches yet" — statements about the project, made on the strength of a
 * request the caller was refused.
 *
 * Storage had already learned to tell a refusal from a failure. These assert
 * that the other four did too, and that the ordinary empty state still shows
 * when the list really is empty.
 */

const listBackups = jest.fn<() => Promise<unknown>>();
const listJobs = jest.fn<() => Promise<unknown>>();
const listKeys = jest.fn<() => Promise<unknown>>();
const listBranches = jest.fn<() => Promise<unknown>>();
const getJobLogs = jest.fn<() => Promise<unknown>>();

const client = {
    backups: { list: listBackups },
    cron: { listJobs, getJobLogs },
    apiKeys: { listKeys }
};

const databaseAdmin = {
    listBranches,
    createBranch: jest.fn(),
    deleteBranch: jest.fn(),
    switchBranch: jest.fn()
};

/** The catalogue `t` reads from: English, unless a test swaps in another. */
let translate = (key: string): string => en[key as keyof typeof en] ?? key;

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string) => translate(key),
        i18n: { language: "en" }
    }),
    useNavigationGroupLabel: () => (group: string) => group,
    useRebaseClient: () => client,
    useRebaseContext: () => ({ databaseAdmin }),
    useSnackbarController: () => ({ open: jest.fn() }),
    ConfirmationDialog: () => null,
    ErrorView: ({ title, error }: { title?: string; error: string }) => (
        <div>
            <span>{title}</span>
            <span>{error}</span>
        </div>
    )
}));

jest.mock("@rebasepro/types", () => ({
    isBranchAdmin: () => true
}));

import { BackupsView } from "../src/components/Backups/BackupsView";
import { CronJobsView } from "../src/components/CronJobs/CronJobsView";
import { ApiKeysView } from "../src/components/ApiKeys/ApiKeysView";
import { BranchesView } from "../src/components/Branches/BranchesView";
import type { ApiKeyMasked, CronJobStatus } from "@rebasepro/types";

const refused = () => Object.assign(new Error("Not authorized"), { status: 403 });

beforeEach(() => {
    [listBackups, listJobs, listKeys, listBranches, getJobLogs].forEach(m => m.mockReset());
    translate = (key: string): string => en[key as keyof typeof en] ?? key;
    getJobLogs.mockResolvedValue({ logs: [] });
});

describe("a refused listing is not an empty one", () => {

    it("Backups says it was refused, not that there are none", async () => {
        listBackups.mockRejectedValue(refused());
        render(<BackupsView/>);

        await waitFor(() => {
            expect(screen.getByText(/cannot list this project's backups/i)).toBeTruthy();
        });
        expect(screen.queryByText(/No backups found yet/i)).toBeNull();
    });

    it("Cron Jobs says it was refused, not that none are registered", async () => {
        listJobs.mockRejectedValue(refused());
        render(<CronJobsView/>);

        await waitFor(() => {
            expect(screen.getByText(/cannot list this project's cron jobs/i)).toBeTruthy();
        });
        expect(screen.queryByText(/No Cron Jobs Registered/i)).toBeNull();
    });

    it("API Keys says it was refused, not that there are none", async () => {
        listKeys.mockRejectedValue(refused());
        render(<ApiKeysView/>);

        await waitFor(() => {
            expect(screen.getByText(/cannot list this project's API keys/i)).toBeTruthy();
        });
        expect(screen.queryByText(/No API keys yet/i)).toBeNull();
    });

    it("Branches says it was refused, not that there are none", async () => {
        listBranches.mockRejectedValue(refused());
        render(<BranchesView/>);

        await waitFor(() => {
            expect(screen.getByText(/cannot list this project's branches/i)).toBeTruthy();
        });
        expect(screen.queryByText(/No branches yet/i)).toBeNull();
    });
});

describe("a failure that is not a refusal is still a failure", () => {

    it("Backups offers a retry and names what broke", async () => {
        listBackups.mockRejectedValue(new Error("connect ECONNREFUSED"));
        render(<BackupsView/>);

        await waitFor(() => {
            expect(screen.getByText(/Could not read this project's backups/i)).toBeTruthy();
        });
        expect(screen.getByText(/ECONNREFUSED/)).toBeTruthy();
    });
});

describe("an empty list is still empty", () => {

    it("Backups shows the ordinary empty state when the call succeeds", async () => {
        listBackups.mockResolvedValue({ backups: [], destinationKind: "local", configured: true });
        render(<BackupsView/>);

        await waitFor(() => {
            expect(screen.getByText(/No backups found yet/i)).toBeTruthy();
        });
    });

    it("Branches shows the ordinary empty state when the call succeeds", async () => {
        listBranches.mockResolvedValue([]);
        render(<BranchesView/>);

        await waitFor(() => {
            expect(screen.getByText(/No branches yet/i)).toBeTruthy();
        });
    });
});

/**
 * The same mistake one level down. A job whose execution history could not be
 * read showed "No executions yet" — about a job that may run every minute —
 * with a snackbar that was gone before anyone looked.
 */
describe("a job's executions that could not be read", () => {
    const nightly: CronJobStatus = {
        id: "nightly",
        name: "Nightly cleanup",
        schedule: "0 3 * * *",
        enabled: true,
        state: "idle",
        totalRuns: 12,
        totalFailures: 0
    };

    it("says they could not be read, not that the job never ran", async () => {
        listJobs.mockResolvedValue({ jobs: [nightly] });
        getJobLogs.mockRejectedValue(new Error("connect ECONNREFUSED"));
        render(<CronJobsView/>);

        fireEvent.click(await screen.findByText("Nightly cleanup"));

        expect(await screen.findByText(translate("studio_cron_logs_read_failed"))).toBeTruthy();
        expect(screen.queryByText("No executions yet")).toBeNull();
    });

    it("still says there are none when there are none", async () => {
        listJobs.mockResolvedValue({ jobs: [nightly] });
        render(<CronJobsView/>);

        fireEvent.click(await screen.findByText("Nightly cleanup"));

        expect(await screen.findByText("No executions yet")).toBeTruthy();
    });
});

/**
 * The heading over revoked and expired keys was built as
 * `t("studio_api_keys_revoke") + "d / Expired"` — English morphology glued
 * onto a translated verb: "Revocard / Expired", "Widerrufend / Expired".
 */
describe("the revoked-keys heading", () => {
    it("is one translated string", async () => {
        // In English the glued version happens to read right, so the keys are
        // rendered as themselves: anything outside a key is text no locale
        // translates.
        translate = (key: string) => `‹${key}›`;
        const revoked: ApiKeyMasked = {
            id: "k1",
            name: "Old integration",
            key_prefix: "rbk_live_abc",
            permissions: [],
            admin: false,
            rate_limit: null,
            created_by: "admin",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
            last_used_at: null,
            expires_at: null,
            revoked_at: "2026-01-02T00:00:00Z"
        };
        listKeys.mockResolvedValue({ keys: [revoked] });
        render(<ApiKeysView/>);

        expect(await screen.findByText("‹studio_api_keys_inactive_heading›")).toBeTruthy();
    });
});
