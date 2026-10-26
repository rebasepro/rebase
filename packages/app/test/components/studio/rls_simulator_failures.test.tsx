/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthController } from "@rebasepro/cms-types";

/**
 * "Simulate access" says when something it asked the server failed, instead of
 * reading as a state that is merely slow or empty.
 *
 * - The banner's count of what the identity can read: a failed preview left it
 *   at "Counting what this identity can read…" for as long as the simulation
 *   ran, the error only in the console.
 * - The user search: a failed request read as "No user matches this search."
 * - The options: an error from an earlier open stayed on screen beside the
 *   list a later open loaded.
 */

jest.mock("../../../src/hooks/useTranslation", () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string>) => params ? `${key} ${JSON.stringify(params)}` : key
    })
}));

const listUsersPaginated = jest.fn<(options: unknown) => Promise<{ users: unknown[] }>>();
jest.mock("../../../src/hooks/useRebaseClient", () => ({
    useRebaseClient: () => ({ admin: { listUsersPaginated } })
}));

import { RlsSimulationBannerPanel, RlsSimulatorBarPanel } from "../../../src/components/studio/RlsSimulatorPanel";
import { RlsSimulationContext, type RlsSimulationController } from "../../../src/contexts/RlsSimulationContext";
import { AuthControllerContext } from "../../../src/contexts/AuthControllerContext";
import { ApiConfigProvider } from "../../../src/hooks/ApiConfigContext";

const admin = { user: { uid: "admin-1", roles: ["admin"] } } as unknown as AuthController;

function json(status: number, body: unknown): Response {
    return { ok: status < 400, status, statusText: "", json: async () => body } as Response;
}

const fetchMock = jest.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
    fetchMock.mockReset();
    listUsersPaginated.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
    jest.restoreAllMocks();
});

function Shell({ simulation, children }: { simulation: RlsSimulationController["simulation"]; children: React.ReactNode }) {
    const controller: RlsSimulationController = { available: true, simulation, label: null, setSimulation: () => undefined };
    return (
        <ApiConfigProvider apiUrl={"http://api.test"}>
            <AuthControllerContext.Provider value={admin}>
                <RlsSimulationContext.Provider value={controller}>
                    {children}
                </RlsSimulationContext.Provider>
            </AuthControllerContext.Provider>
        </ApiConfigProvider>
    );
}

describe("the Simulate access banner", () => {
    it("says the count failed, and why, when the preview fails", async () => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        fetchMock.mockResolvedValue(json(400, { error: { message: "No user has id u-missing" } }));

        render(<Shell simulation={{ role: "customer", userId: "u-missing" }}><RlsSimulationBannerPanel/></Shell>);

        await waitFor(() => expect(screen.getByRole("status").textContent).toContain("rls_simulation_count_failed"));
        expect(screen.getByRole("status").textContent).toContain("No user has id u-missing");
        expect(screen.getByRole("status").textContent).not.toContain("rls_simulation_counting");
    });
});

describe("the Simulate access popover", () => {
    async function openUserTab() {
        fireEvent.click(screen.getByRole("button", { name: "rls_simulate_access" }));
        const userTab = await screen.findByRole("tab", { name: "rls_simulate_tab_user" });
        fireEvent.mouseDown(userTab);
        fireEvent.click(userTab);
    }

    it("tells a failed user search from one that found no one", async () => {
        fetchMock.mockResolvedValue(json(200, { roles: [], apiKeys: [] }));
        listUsersPaginated.mockRejectedValue(new Error("users unavailable"));

        render(<Shell simulation={null}><RlsSimulatorBarPanel/></Shell>);
        await openUserTab();

        expect(await screen.findByText(/rls_simulate_users_error.*users unavailable/, undefined, { timeout: 3000 })).toBeTruthy();
        expect(screen.queryByText("rls_simulate_no_users")).toBeNull();
    });

    it("drops an earlier options error once a later open loads them", async () => {
        fetchMock.mockResolvedValueOnce(json(500, { error: { message: "busy" } }));
        render(<Shell simulation={null}><RlsSimulatorBarPanel/></Shell>);

        const trigger = screen.getByRole("button", { name: "rls_simulate_access" });
        fireEvent.click(trigger);
        expect(await screen.findByText(/rls_simulate_options_error/)).toBeTruthy();

        // Close and open again: the options are asked for again, and load.
        fetchMock.mockResolvedValue(json(200, { roles: [{ id: "customer", name: "customer" }], apiKeys: [] }));
        await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); });
        fireEvent.click(trigger);

        expect(await screen.findByText("customer")).toBeTruthy();
        expect(screen.queryByText(/rls_simulate_options_error/)).toBeNull();
    });
});
