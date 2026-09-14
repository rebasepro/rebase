/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * A backup is a `.dump` and a `.globals.sql` beside it, holding the database
 * roles the dump's grants and RLS policies name. The panel used to list and
 * download only the `.dump`, so a backup taken out through Studio restored
 * into a new Postgres without its roles and stopped at the first GRANT. The
 * CLI keeps the two together everywhere; these tests check that the panel does
 * too, and that a dump without a sidecar says so rather than looking complete.
 */

const list = jest.fn<() => Promise<unknown>>();
const download = jest.fn<(key: string) => Promise<Blob>>();

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string) => en[key as keyof typeof en] ?? key,
        i18n: { language: "en" }
    }),
    useRebaseClient: () => ({ backups: { list, download } }),
    useSnackbarController: () => ({ open: jest.fn() })
}));

import { BackupsView } from "../src/components/Backups/BackupsView";

const PAIRED = {
    key: "/srv/backups/rebase-app-20260714T030000Z.dump",
    name: "rebase-app-20260714T030000Z.dump",
    globalsKey: "/srv/backups/rebase-app-20260714T030000Z.globals.sql",
    destinationKind: "local"
};
const UNPAIRED = {
    key: "/srv/backups/rebase-app-20260101T000000Z.dump",
    name: "rebase-app-20260101T000000Z.dump",
    destinationKind: "local"
};

describe("Backups panel and the roles sidecar", () => {
    const savedAs: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;

    beforeEach(() => {
        list.mockReset();
        download.mockReset();
        savedAs.length = 0;
        download.mockResolvedValue(new Blob(["x"]));
        // jsdom has neither object URLs nor downloads: record what would be saved.
        URL.createObjectURL = () => "blob:test";
        URL.revokeObjectURL = () => {};
        HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
            savedAs.push(this.download);
        };
    });

    afterEach(() => {
        HTMLAnchorElement.prototype.click = originalClick;
    });

    it("offers the roles file where there is one, and flags the dump that has none", async () => {
        list.mockResolvedValue({ backups: [PAIRED, UNPAIRED], destinationKind: "local", configured: true });
        render(<BackupsView/>);

        await waitFor(() => expect(screen.getByText(PAIRED.name)).toBeTruthy());
        expect(screen.getAllByText(en.studio_backups_roles_file!)).toHaveLength(1);
        expect(screen.getAllByText(en.studio_backups_no_roles_file!)).toHaveLength(1);
    });

    it("downloads the sidecar's own key, saved under the name restore looks for", async () => {
        list.mockResolvedValue({ backups: [PAIRED], destinationKind: "local", configured: true });
        render(<BackupsView/>);

        fireEvent.click(await screen.findByText(en.studio_backups_roles_file!));
        await waitFor(() => expect(savedAs).toEqual(["rebase-app-20260714T030000Z.globals.sql"]));
        expect(download).toHaveBeenCalledWith(PAIRED.globalsKey);
    });
});
