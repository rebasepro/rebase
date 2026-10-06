/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BranchInfo } from "@rebasepro/types";

/**
 * "Source Database" in the Create Branch dialog listed the existing branches
 * by name and sent the name as the database to copy. A branch's database is
 * not its name — `staging` lives in `rb_staging` — so the server ran
 * `CREATE DATABASE … TEMPLATE "staging"`: an error every time, or, where a
 * database really is called `staging`, a copy of that one, reported as
 * "created from staging".
 */

const staging: BranchInfo = { name: "staging", database: "rb_staging", parentDatabase: "app", createdAt: new Date("2026-10-01T00:00:00Z") };

const listBranches = jest.fn(async (): Promise<BranchInfo[]> => [staging]);
const createBranch = jest.fn(async (name: string, _options?: { source?: string }): Promise<BranchInfo> =>
    ({ name, database: `rb_${name}`, parentDatabase: "rb_staging", createdAt: new Date() }));

const databaseAdmin = {
    listBranches,
    createBranch,
    deleteBranch: jest.fn()
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string) => en[key as keyof typeof en] ?? key,
        i18n: { language: "en" }
    }),
    useRebaseContext: () => ({ databaseAdmin }),
    useSnackbarController: () => ({ open: jest.fn() }),
    ConfirmationDialog: () => null
}));

import { BranchesView } from "../src/components/Branches/BranchesView";

beforeEach(() => {
    listBranches.mockClear();
    createBranch.mockClear();
});

describe("creating a branch from another branch", () => {
    it("copies the chosen branch's database", async () => {
        render(<BranchesView/>);
        const option = await screen.findByRole("option", { name: "staging" });
        fireEvent.change(screen.getByRole("combobox"), { target: { value: (option as HTMLOptionElement).value } });
        fireEvent.change(screen.getByPlaceholderText(/feature-auth/), { target: { value: "hotfix" } });

        fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));

        await waitFor(() => expect(createBranch).toHaveBeenCalled());
        expect(createBranch).toHaveBeenCalledWith("hotfix", { source: "rb_staging" });
    });

    it("copies the main database when no branch is chosen", async () => {
        render(<BranchesView/>);
        await screen.findByRole("option", { name: "staging" });
        fireEvent.change(screen.getByPlaceholderText(/feature-auth/), { target: { value: "hotfix" } });

        fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));

        await waitFor(() => expect(createBranch).toHaveBeenCalled());
        expect(createBranch).toHaveBeenCalledWith("hotfix", undefined);
    });
});
