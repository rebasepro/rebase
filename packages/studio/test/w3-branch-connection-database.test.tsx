/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { BranchInfo } from "@rebasepro/types";

/**
 * A branch's connection details name the database its record says it is.
 *
 * The server keeps that name rather than deriving it from the branch's name
 * again: a branch made under an older naming scheme is `my-feature` in
 * `rb_myfeature`, and `rb_my-feature` — the name with the prefix — is a
 * database that does not exist.
 */

const legacy: BranchInfo = {
    name: "my-feature",
    database: "rb_myfeature",
    parentDatabase: "app",
    createdAt: new Date("2026-10-01T00:00:00Z")
};

const databaseAdmin = {
    listBranches: jest.fn(async (): Promise<BranchInfo[]> => [legacy]),
    createBranch: jest.fn(),
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

// The diff and merge are their own pane; only the details it is handed matter here.
jest.mock("../src/components/Branches/BranchDiffView", () => ({
    BranchDiffView: ({ details }: { details: React.ReactNode }) => <div>{details}</div>
}));

import { BranchesView } from "../src/components/Branches/BranchesView";

describe("a branch's connection details", () => {
    it("name the database the branch's record names", async () => {
        render(<BranchesView/>);
        // The first is the list row; the create dialog offers the branch as a source too.
        fireEvent.click((await screen.findAllByText("my-feature"))[0]);

        expect(screen.getByText("rb_myfeature")).toBeTruthy();
        expect(screen.getByText("DATABASE_URL=…/rb_myfeature")).toBeTruthy();
        expect(screen.queryByText(/rb_my-feature/)).toBeNull();
    });
});
