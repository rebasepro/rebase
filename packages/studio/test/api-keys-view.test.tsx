/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { summarizeScopes, type ApiKeyMasked } from "@rebasepro/types";

/**
 * The key panel speaks scopes: what a key may call is its scopes, which rows
 * it reads is its RLS roles, and a service key running as `admin` reads every
 * row — which the panel has to say, because nothing else about such a key
 * looks wider than a narrow one.
 *
 * The create dialog has to send what the server mints from, and when the
 * server refuses, say which rule refused it beside the server's own words.
 */

const listKeys = jest.fn<() => Promise<{ keys: ApiKeyMasked[] }>>();
const createKey = jest.fn<(body: unknown) => Promise<unknown>>();
const revokeKey = jest.fn<() => Promise<{ success: boolean }>>();
const listPersonalKeys = jest.fn<() => Promise<{ keys: ApiKeyMasked[] }>>();
const createPersonalKey = jest.fn<(body: unknown) => Promise<unknown>>();
const listScopes = jest.fn<() => Promise<unknown>>();
const listRoles = jest.fn<() => Promise<unknown>>();

const client = {
    apiKeys: { listKeys, createKey, revokeKey },
    personalKeys: { listKeys: listPersonalKeys, createKey: createPersonalKey, revokeKey, listScopes },
    admin: { listRoles }
};

const translate = (key: string, vars?: Record<string, string | number>): string => {
    let text: string = en[key as keyof typeof en] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(`{{${name}}}`, String(value));
    return text;
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t: translate, i18n: { language: "en" } }),
    useRebaseClient: () => client,
    useSnackbarController: () => ({ open: jest.fn() }),
    useStudioCollectionRegistry: () => ({ collections: [{ slug: "posts", name: "Posts" }] }),
    useStorageSources: () => ({ registry: {}, sources: {} }),
    useApiBase: () => undefined,
    useApiConfig: () => undefined,
    ErrorView: ({ title, error }: { title?: string; error: string }) => (
        <div>
            <span>{title}</span>
            <span>{error}</span>
        </div>
    )
}));

/**
 * The shared kit stub renders `Tabs` without wiring `onValueChange`, so a tab
 * could be seen and never chosen. Here the two talk through a context, the way
 * Radix's do.
 */
jest.mock("@rebasepro/ui", () => {
    const ReactActual: typeof React = jest.requireActual("react");
    const stub: Record<string, unknown> = jest.requireActual("@rebasepro/ui");
    const TabsContext = ReactActual.createContext<(value: string) => void>(() => undefined);
    const Tabs = ({ children, onValueChange }: { children: React.ReactNode; onValueChange: (value: string) => void }) =>
        ReactActual.createElement(TabsContext.Provider, { value: onValueChange },
            ReactActual.createElement("div", { role: "tablist" }, children));
    const Tab = ({ children, value }: { children: React.ReactNode; value: string }) => {
        const choose = ReactActual.useContext(TabsContext);
        return ReactActual.createElement("button", { type: "button", role: "tab", onClick: () => choose(value) }, children);
    };
    return new Proxy(stub, {
        get: (target, key) => key === "Tabs" ? Tabs : key === "Tab" ? Tab : target[key as string]
    });
});

import { ApiKeysView } from "../src/components/ApiKeys/ApiKeysView";

const everyScope = summarizeScopes().map(summary => summary.scope);

function serviceKey(overrides: Partial<ApiKeyMasked>): ApiKeyMasked {
    return {
        id: "k1",
        name: "Nightly export",
        kind: "service",
        key_prefix: "rk_live_abcd",
        scopes: ["data:read"],
        roles: [],
        owner_uid: null,
        rate_limit: null,
        created_by: "admin-uid",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
        ...overrides
    };
}

const apiError = (code: string, message: string, status: number) =>
    Object.assign(new Error(message), { code, status });

beforeEach(() => {
    [listKeys, createKey, revokeKey, listPersonalKeys, createPersonalKey, listScopes, listRoles].forEach(m => m.mockReset());
    listKeys.mockResolvedValue({ keys: [] });
    listPersonalKeys.mockResolvedValue({ keys: [] });
    listScopes.mockResolvedValue({ scopes: summarizeScopes(), held: everyScope });
    listRoles.mockResolvedValue({ roles: [] });
});

describe("a key's detail", () => {
    it("says a key running as admin reads every row", async () => {
        listKeys.mockResolvedValue({ keys: [serviceKey({ roles: ["admin"] })] });
        render(<ApiKeysView/>);

        fireEvent.click(await screen.findByText("Nightly export"));

        expect(await screen.findByText(en.studio_api_keys_admin_reads_every_row!)).toBeTruthy();
    });

    it("does not say it of a key that runs as service alone", async () => {
        listKeys.mockResolvedValue({ keys: [serviceKey({ roles: [] })] });
        render(<ApiKeysView/>);

        fireEvent.click(await screen.findByText("Nightly export"));

        expect(await screen.findByText(en.studio_api_keys_roles_service_only!)).toBeTruthy();
        expect(screen.queryByText(en.studio_api_keys_admin_reads_every_row!)).toBeNull();
    });

    it("shows a collection-narrowed scope as the grant on those collections", async () => {
        listKeys.mockResolvedValue({ keys: [serviceKey({ scopes: ["data:read:posts", "data:read:authors", "logs:read"] })] });
        render(<ApiKeysView/>);

        fireEvent.click(await screen.findByText("Nightly export"));

        expect(await screen.findByText("Read data")).toBeTruthy();
        expect(screen.getByText("posts")).toBeTruthy();
        expect(screen.getByText("authors")).toBeTruthy();
        expect(screen.queryByText(en.studio_api_keys_target_all_collection!)).toBeNull();
        expect(screen.getByText("Read server logs")).toBeTruthy();
    });
});

describe("creating a service key", () => {
    async function openDialog() {
        render(<ApiKeysView/>);
        fireEvent.click(await screen.findByText(en.studio_api_keys_new!));
        await screen.findByText(en.studio_api_keys_scopes_offered_note!);
    }

    it("mints data:read by default, with the roles typed in", async () => {
        createKey.mockResolvedValue({ key: { ...serviceKey({ roles: ["admin"] }), key: "rk_live_secret" } });
        await openDialog();

        fireEvent.change(screen.getByPlaceholderText(en.studio_api_keys_field_name_placeholder!), { target: { value: "Nightly export" } });
        fireEvent.change(screen.getByPlaceholderText(en.studio_api_keys_roles_other_placeholder!), { target: { value: "admin, service" } });
        fireEvent.click(screen.getByText(en.studio_api_keys_create!));

        await waitFor(() => expect(createKey).toHaveBeenCalled());
        expect(createKey.mock.calls[0][0]).toEqual({
            name: "Nightly export",
            scopes: ["data:read"],
            roles: ["admin"],
            rate_limit: null,
            expires_at: null
        });
        expect(await screen.findByText("rk_live_secret")).toBeTruthy();
    });

    it("never offers key management, even to a caller who holds it", async () => {
        await openDialog();

        expect(screen.getByText("users:write")).toBeTruthy();
        expect(screen.queryByText("keys:read")).toBeNull();
        expect(screen.queryByText("keys:write")).toBeNull();
    });

    it("offers only the scopes the caller holds", async () => {
        listScopes.mockResolvedValue({ scopes: summarizeScopes(), held: ["data:read", "data:write", "logs:read"] });
        await openDialog();

        expect(screen.getByText("logs:read")).toBeTruthy();
        expect(screen.queryByText("users:read")).toBeNull();
        expect(screen.queryByText("schema:write")).toBeNull();
    });

    it("names a refusal and keeps the server's message", async () => {
        createKey.mockRejectedValue(apiError("SCOPE_EXCEEDS_CREATOR",
            "A key cannot hold more than the account creating it, and you do not hold logs:read.", 403));
        await openDialog();

        fireEvent.change(screen.getByPlaceholderText(en.studio_api_keys_field_name_placeholder!), { target: { value: "CI" } });
        fireEvent.click(screen.getByText(en.studio_api_keys_create!));

        expect(await screen.findByText(en.studio_api_keys_error_scope_exceeds_creator!)).toBeTruthy();
        expect(screen.getByText(/you do not hold logs:read/)).toBeTruthy();
    });
});

describe("my keys", () => {
    it("explains personal keys are switched off, rather than reporting a failure", async () => {
        listPersonalKeys.mockRejectedValue(apiError("PERSONAL_KEYS_DISABLED", "Personal API keys are switched off on this backend.", 403));
        render(<ApiKeysView/>);

        fireEvent.click(await screen.findByText(en.studio_api_keys_tab_personal!));

        expect(await screen.findByText(en.studio_api_keys_personal_off_title!)).toBeTruthy();
        expect(screen.getByText("auth: { personalKeys: true }")).toBeTruthy();
        expect(screen.queryByText(en.studio_api_keys_personal_read_failed!)).toBeNull();
    });

    it("creates a personal key without roles or a rate limit", async () => {
        createPersonalKey.mockResolvedValue({ key: { ...serviceKey({ kind: "personal", owner_uid: "u1" }), key: "rk_live_mine" } });
        render(<ApiKeysView/>);

        fireEvent.click(await screen.findByText(en.studio_api_keys_tab_personal!));
        fireEvent.click(await screen.findByText(en.studio_api_keys_new!));
        await screen.findByText(en.studio_api_keys_scopes_offered_note!);

        expect(screen.queryByPlaceholderText(en.studio_api_keys_roles_other_placeholder!)).toBeNull();
        fireEvent.change(screen.getByPlaceholderText(en.studio_api_keys_field_name_placeholder!), { target: { value: "My laptop" } });
        fireEvent.click(screen.getByText(en.studio_api_keys_create!));

        await waitFor(() => expect(createPersonalKey).toHaveBeenCalled());
        expect(createPersonalKey.mock.calls[0][0]).toEqual({ name: "My laptop", scopes: ["data:read"], expires_at: null });
        expect(createKey).not.toHaveBeenCalled();
        expect(await screen.findByText("rk_live_mine")).toBeTruthy();
    });
});
