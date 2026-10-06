/**
 * @jest-environment jsdom
 */
import React, { useState } from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

/**
 * The "Run as" picker lists one page of a server search: 50 users. Its header
 * counted the users on that page ("50 users"), the server's total was dropped,
 * and the "Showing N of M" notice only appeared past 100 rows, which a page of
 * 50 never reaches. In a project of 500 users the picker presented its first
 * page as everyone.
 */

const page = Array.from({ length: 50 }, (_, i) => ({
    uid: `user-${i}`, email: `user${i}@example.test`, displayName: null, photoURL: null, roles: [], disabled: false
}));
let serverTotal = 500;
const listUsersPaginated = jest.fn(async () => ({ users: page, total: serverTotal, limit: 50, offset: 0 }));

const appContext = {
    authController: { user: { uid: "admin-1", email: "admin@example.test", displayName: null, roles: ["admin"] } }
};
const appClient = { admin: { listUsersPaginated } };

jest.mock("@rebasepro/app", () => ({
    useRebaseContext: () => appContext,
    useRebaseClient: () => appClient,
    // The real picker; the design system under it is the test stub, whose
    // popover renders its content without being opened.
    UserSelectPopover: jest.requireActual<typeof import("../../app/src/components/UserSelectPopover")>(
        "../../app/src/components/UserSelectPopover"
    ).UserSelectPopover
}));

import { AuthSimulationSelector } from "../src/components/AuthSimulationSelector";
import { useRunAsUsers } from "../src/components/useRunAsUsers";
import type { SelectableUser } from "@rebasepro/app";

function Picker() {
    const { users, currentUser, loading, onSearchTextChange, totalCount } = useRunAsUsers();
    const [selectedUser, setSelectedUser] = useState<SelectableUser | null>(null);
    return (
        <AuthSimulationSelector
            authMode="jwt"
            setAuthMode={() => undefined}
            selectedUser={selectedUser}
            setSelectedUser={setSelectedUser}
            users={users}
            loading={loading}
            onUserSearchTextChange={onSearchTextChange}
            userTotalCount={totalCount}
            currentUser={currentUser}
        />
    );
}

describe("the Run as picker's count", () => {
    it("says the list is the first page of how many the server matched", async () => {
        serverTotal = 500;
        render(<Picker/>);

        expect(await screen.findByText("50 of 500 users")).toBeTruthy();
        expect(screen.getByText(/Showing the first 50 of 500 users/)).toBeTruthy();
    });

    it("counts the users listed when that is all of them", async () => {
        serverTotal = 50;
        render(<Picker/>);

        expect(await screen.findByText("50 users")).toBeTruthy();
        expect(screen.queryByText(/Showing the first/)).toBeNull();
    });
});
