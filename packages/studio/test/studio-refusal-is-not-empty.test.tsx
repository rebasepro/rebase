/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";

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

const client = {
    backups: { list: listBackups },
    cron: { listJobs, getJobLogs: async () => ({ logs: [] }) },
    apiKeys: { listKeys }
};

const databaseAdmin = {
    listBranches,
    createBranch: jest.fn(),
    deleteBranch: jest.fn(),
    switchBranch: jest.fn()
};

jest.mock("@rebasepro/app", () => ({
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

const refused = () => Object.assign(new Error("Not authorized"), { status: 403 });

beforeEach(() => {
    [listBackups, listJobs, listKeys, listBranches].forEach(m => m.mockReset());
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
