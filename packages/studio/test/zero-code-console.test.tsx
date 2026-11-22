/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

const snackbarOpen = jest.fn();

jest.mock("@rebasepro/app", () => ({
    useStudioCollectionRegistry: () => ({ getCollection: () => undefined }),
    useApiBase: () => "/api",
    useApiConfig: () => ({ apiUrl: "http://localhost:3000", getAuthToken: async () => "test-token" }),
    useAuthController: () => ({ getAuthToken: async () => "test-token" }),
    useSnackbarController: () => ({ open: snackbarOpen }),
    useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
    useTableDescriptors: () => ({
        status: "ready",
        tables: [
            {
                name: "tasks",
                slug: "tasks",
                table: "tasks",
                schema: "public",
                kind: "table",
                columns: [],
                primaryKey: ["id"],
                relations: [],
                rls: { posture: "rules", rules: [], defaultPolicies: false }
            }
        ]
    })
}));

// The kit's stub, with the rows grid rendering its cells: the stub's
// `VirtualTable` draws nothing, and the real one measures a container jsdom
// never lays out.
jest.mock("@rebasepro/ui", () => {
    const stub = jest.requireActual<Record<string, unknown>>("@rebasepro/ui");
    const overrides: Record<string, unknown> = {
        TextField: ({ label, multiline, minRows, inputClassName: _ic, inputStyle: _is, endAdornment: _ea, invisible: _inv, error: _err, ...rest }: Record<string, unknown>) => (
            <label>
                {typeof label === "string" ? label : null}
                {multiline ? <textarea rows={typeof minRows === "number" ? minRows : 3} {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} /> : <input {...(rest as React.InputHTMLAttributes<HTMLInputElement>)} />}
            </label>
        ),
        VirtualTable: ({ data, columns, cellRenderer }: {
            data?: Record<string, unknown>[];
            columns: { key: string; width: number }[];
            cellRenderer: (params: { rowData: Record<string, unknown>; column: { key: string; width: number }; rowIndex: number; columnIndex: number }) => React.ReactNode;
        }) => <div role="grid">
            {(data ?? []).map((rowData, rowIndex) => <div role="row" key={rowIndex}>
                {columns.map((column, columnIndex) => <div role="gridcell" key={column.key}>
                    {cellRenderer({ rowData, column, rowIndex, columnIndex })}
                </div>)}
            </div>)}
        </div>
    };
    return new Proxy(overrides, {
        get: (target, key: string | symbol) => typeof key === "string" && key in target ? target[key] : stub[key as string],
        has: () => true
    });
});

import { TableEditorView } from "../src/components/TableEditor/TableEditorView";
import { DirectRlsPoliciesPanel } from "../src/components/RLSEditor/DirectRlsPoliciesPanel";
import { StoragePoliciesPanel } from "../src/components/StorageView/StoragePoliciesPanel";
import { DbCronJobsPanel } from "../src/components/CronJobs/DbCronJobsPanel";
import { WebhooksView } from "../src/components/Webhooks/WebhooksView";
import { UsersAndRolesView } from "../src/components/UsersAndRoles/UsersAndRolesView";

const originalFetch = globalThis.fetch;

function fakeResponse(body: unknown, status = 200) {
    const payload = JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Error",
        text: async () => payload,
        json: async () => body
    };
}

function installFetch(handler: (url: string) => ReturnType<typeof fakeResponse>) {
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async (input: RequestInfo | URL) => handler(String(input))
    });
}

describe("Zero-code Studio console views", () => {
    beforeEach(() => {
        snackbarOpen.mockReset();
    });

    afterEach(() => {
        Object.defineProperty(globalThis, "fetch", {
            configurable: true,
            writable: true,
            value: originalFetch
        });
    });

    it("TableEditorView loads PostgreSQL tables and rows over /api/admin/db/tables and /api/data", async () => {
        installFetch((url) => {
            if (url.endsWith("/api/admin/db/tables")) {
                return fakeResponse({
                    tables: [
                        {
                            schema: "public",
                            name: "tasks",
                            slug: "tasks",
                            rlsEnabled: true,
                            rlsForced: false,
                            exposed: true,
                            served: true,
                            columns: [
                                { name: "id", key: "id", dataType: "uuid", udtName: "uuid", nullable: false, default: "gen_random_uuid()", primaryKey: true, unique: true },
                                { name: "title", key: "title", dataType: "text", udtName: "text", nullable: false, default: null, primaryKey: false, unique: false }
                            ],
                            policies: [{ name: "auth_all", operation: "ALL", roles: ["public"], using: "true", withCheck: "true" }],
                            indexes: [],
                            meta: null
                        }
                    ]
                });
            }
            if (url.includes("/api/data/tasks")) {
                return fakeResponse({
                    data: [{ id: "row-1", title: "Ship zero-code BaaS" }]
                });
            }
            return fakeResponse({});
        });

        render(<TableEditorView />);

        expect(await screen.findByText("public.tasks")).toBeTruthy();
        expect(await screen.findByText("Ship zero-code BaaS")).toBeTruthy();
    });

    it("WebhooksView renders database webhooks from /api/admin/webhooks", async () => {
        installFetch((url) => {
            if (url.endsWith("/api/admin/webhooks")) {
                return fakeResponse({
                    webhooks: [
                        {
                            id: "wh-1",
                            name: "Order alerts",
                            url: "https://hooks.example.com/orders",
                            events: ["INSERT", "UPDATE"],
                            table: "tasks",
                            hasSecret: true,
                            headers: {},
                            enabled: true
                        }
                    ]
                });
            }
            return fakeResponse({});
        });

        render(<WebhooksView />);

        expect(await screen.findByText("Order alerts")).toBeTruthy();
        expect(await screen.findByText("https://hooks.example.com/orders")).toBeTruthy();
        expect((await screen.findAllByText("tasks")).length).toBeGreaterThanOrEqual(1);
    });

    it("StoragePoliciesPanel, DirectRlsPoliciesPanel, and DbCronJobsPanel render backend contracts cleanly", async () => {
        installFetch((url) => {
            if (url.endsWith("/api/admin/storage/policies")) {
                return fakeResponse({
                    policies: [
                        {
                            id: "sp-1",
                            name: "Owner avatars",
                            bucket: "default",
                            pathPattern: "users/:uid/**",
                            operations: ["read", "write"],
                            rule: { kind: "owner", param: "uid" },
                            priority: 100,
                            enabled: true
                        }
                    ]
                });
            }
            if (url.endsWith("/api/admin/db/tables")) {
                return fakeResponse({
                    tables: [
                        {
                            schema: "public",
                            name: "orders",
                            rlsEnabled: true,
                            policies: [
                                { name: "orders_select_only", operation: "SELECT", roles: ["PUBLIC"], using: "true", withCheck: null }
                            ]
                        }
                    ]
                });
            }
            if (url.endsWith("/api/admin/cron/jobs")) {
                return fakeResponse({
                    jobs: [
                        {
                            id: "cj-1",
                            name: "hourly_ping",
                            schedule: "0 * * * *",
                            kind: "http",
                            config: { url: "https://example.com/cron/ping" },
                            enabled: true
                        }
                    ]
                });
            }
            return fakeResponse({});
        });

        render(<StoragePoliciesPanel />);
        expect(await screen.findByText("Owner avatars")).toBeTruthy();
        expect(await screen.findByText("users/:uid/**")).toBeTruthy();
        expect(await screen.findByText("owner (:uid)")).toBeTruthy();

        render(<DirectRlsPoliciesPanel />);
        expect(await screen.findByText("orders_select_only")).toBeTruthy();
        expect((await screen.findAllByText("SELECT")).length).toBeGreaterThanOrEqual(1);

        render(<DbCronJobsPanel />);
        expect(await screen.findByText("hourly_ping")).toBeTruthy();
        expect(await screen.findByText("POST https://example.com/cron/ping")).toBeTruthy();
    });

    it("UsersAndRolesView lists accounts and zero-code roles", async () => {
        installFetch((url) => {
            if (url.includes("/api/admin/users")) {
                return fakeResponse({
                    users: [
                        {
                            uid: "u-1",
                            email: "admin@rebase.pro",
                            displayName: "Admin User",
                            roles: ["admin"],
                            disabled: false,
                            emailVerified: true,
                            createdAt: "2026-01-01T00:00:00.000Z"
                        }
                    ]
                });
            }
            if (url.endsWith("/api/admin/roles")) {
                return fakeResponse({
                    roles: [
                        { id: "admin", name: "admin", description: "Full access", scopes: [], isDefault: false, assignable: true, source: "built-in" },
                        { id: "support", name: "support", description: "Support desk", scopes: ["users:read", "logs:read"], isDefault: true, assignable: true, source: "database" }
                    ]
                });
            }
            return fakeResponse({});
        });

        render(<UsersAndRolesView />);

        expect(await screen.findByText("admin@rebase.pro")).toBeTruthy();
        expect(await screen.findByText("Admin User")).toBeTruthy();
    });
});
