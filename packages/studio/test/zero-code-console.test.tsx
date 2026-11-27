/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const snackbarOpen = jest.fn();

jest.mock("@rebasepro/app", () => ({
    useStudioCollectionRegistry: () => ({ getCollection: () => undefined }),
    useApiBase: () => "/api",
    useApiConfig: () => ({ apiUrl: "http://localhost:3000", getAuthToken: async () => "test-token" }),
    useAuthController: () => ({ getAuthToken: async () => "test-token" }),
    useSnackbarController: () => ({ open: snackbarOpen }),
    useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
    useRebaseContext: () => ({ authController: { user: null } }),
    useRebaseClient: () => undefined,
    ConfirmationDialog: () => null,
    UserSelectPopover: () => null,
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
import { RolesView } from "../src/components/Roles/RolesView";

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

interface RecordedRequest {
    url: string;
    method: string;
    body: unknown;
}

function installFetch(handler: (url: string, init?: RequestInit) => ReturnType<typeof fakeResponse>) {
    const calls: RecordedRequest[] = [];
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = (init?.method ?? "GET").toUpperCase();
            let body: unknown = undefined;
            if (typeof init?.body === "string") {
                try {
                    body = JSON.parse(init.body);
                } catch {
                    body = init.body;
                }
            }
            calls.push({ url, method, body });
            return handler(url, init);
        }
    });
    return calls;
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

    it("TableEditorView loads PostgreSQL tables over /api/admin/db/tables and their rows over the admin rows route", async () => {
        const calls = installFetch((url) => {
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
            if (url.includes("/api/admin/db/tables/tasks/rows")) {
                return fakeResponse({
                    columns: [
                        { name: "id", type: "uuid", udt: "uuid", category: "U", notNull: true, default: "gen_random_uuid()", identity: null, generated: null, primaryKey: true, comment: null },
                        { name: "title", type: "text", udt: "text", category: "S", notNull: true, default: null, identity: null, generated: null, primaryKey: false, comment: null }
                    ],
                    rows: [{ id: "row-1", title: "Ship zero-code BaaS" }],
                    count: { value: 1, exact: true },
                    primaryKey: ["id"],
                    readOnly: false,
                    readOnlyReason: null
                });
            }
            return fakeResponse({});
        });

        render(<TableEditorView />);

        expect(await screen.findByText("public.tasks")).toBeTruthy();
        expect(await screen.findByText("Ship zero-code BaaS")).toBeTruthy();
        // Read as the database owner through the admin API, not the data API.
        expect(calls.some(call => call.url.includes("/api/admin/db/tables/tasks/rows?schema=public"))).toBe(true);
        expect(calls.some(call => call.url.includes("/api/data/"))).toBe(false);
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

    it("RolesView lists the roles, with where each came from, and edits only the ones made here", async () => {
        installFetch((url) => {
            if (url.endsWith("/api/admin/roles")) {
                return fakeResponse({
                    roles: [
                        { id: "admin", name: "admin", description: "Full access", scopes: [], isDefault: false, assignable: true, source: "built-in" },
                        { id: "editor", name: "editor", description: "Edits content", scopes: ["schema:read"], isDefault: false, assignable: true, source: "code" },
                        { id: "support", name: "support", description: "Support desk", scopes: ["users:read", "logs:read"], isDefault: true, assignable: true, source: "database" }
                    ]
                });
            }
            return fakeResponse({});
        });

        render(<RolesView />);

        expect(await screen.findByText("support")).toBeTruthy();
        expect(screen.getByText("editor")).toBeTruthy();
        // This file's `t` answers the key itself.
        expect(screen.getByText("studio_roles_source_code")).toBeTruthy();
        expect(screen.getByText("studio_roles_source_builtin")).toBeTruthy();
        // Only the role made at runtime can be edited or deleted: one of each button.
        expect(screen.getAllByLabelText("studio_users_edit_role_aria")).toHaveLength(1);
        expect(screen.getAllByLabelText("studio_users_delete_role_aria")).toHaveLength(1);
    });

    it("DirectRlsPoliciesPanel submits explicit operation + using/withCheck to POST /api/admin/db/tables/:table/policies", async () => {
        const calls = installFetch((url, init) => {
            if (url.endsWith("/api/admin/db/tables")) {
                return fakeResponse({
                    tables: [
                        {
                            schema: "public",
                            name: "orders",
                            rlsEnabled: true,
                            policies: []
                        }
                    ]
                });
            }
            if (url.endsWith("/api/admin/db/tables/orders/policies") && init?.method === "POST") {
                return fakeResponse({ ok: true }, 201);
            }
            return fakeResponse({});
        });

        render(<DirectRlsPoliciesPanel />);
        await screen.findByText("public.orders");

        // Open create policy dialog and click the Admin full access template
        const createButtons = screen.getAllByRole("button", { name: /studio_rls_create_policy|New policy/i });
        fireEvent.click(createButtons[0]);

        const nameInput = screen.getByLabelText("studio_policy_name");
        fireEvent.change(nameInput, { target: { value: "orders_admin_all" } });
        const usingInput = screen.getByLabelText("studio_policy_using_expr");
        fireEvent.change(usingInput, { target: { value: "'admin' = ANY(string_to_array(rebase.roles(), ','))" } });

        const submitBtn = screen.getAllByRole("button", { name: "studio_rls_create_policy" }).at(-1)!;
        fireEvent.click(submitBtn);

        await waitFor(() => {
            const post = calls.find(c => c.method === "POST" && c.url.endsWith("/api/admin/db/tables/orders/policies"));
            expect(post).toBeDefined();
            expect(post?.body).toMatchObject({
                name: "orders_admin_all",
                operation: "ALL",
                using: "'admin' = ANY(string_to_array(rebase.roles(), ','))"
            });
        });
    });

    it("StoragePoliciesPanel submits policy name, pathPattern, operations, and rule to POST /api/admin/storage/policies", async () => {
        const calls = installFetch((url, init) => {
            if (url.endsWith("/api/admin/storage/policies") && (!init?.method || init.method === "GET")) {
                return fakeResponse({ policies: [] });
            }
            if (url.endsWith("/api/admin/storage/policies") && init?.method === "POST") {
                return fakeResponse({ policy: { id: "sp-new" } }, 201);
            }
            return fakeResponse({});
        });

        render(<StoragePoliciesPanel />);
        const addBtn = await screen.findByRole("button", { name: "studio_new_policy" });
        fireEvent.click(addBtn);

        fireEvent.change(screen.getByLabelText("studio_policy_name"), { target: { value: "Private user files" } });
        fireEvent.change(screen.getByLabelText("studio_storage_policies_path_pattern"), { target: { value: "users/:uid/**" } });

        fireEvent.click(screen.getByRole("button", { name: "studio_policy_save" }));

        await waitFor(() => {
            const post = calls.find(c => c.method === "POST" && c.url.endsWith("/api/admin/storage/policies"));
            expect(post).toBeDefined();
            expect(post?.body).toMatchObject({
                name: "Private user files",
                bucket: "default",
                pathPattern: "users/:uid/**",
                enabled: true
            });
        });
    });

    it("WebhooksView submits POST /api/admin/webhooks with table + events + url", async () => {
        const calls = installFetch((url, init) => {
            if (url.endsWith("/api/admin/webhooks") && (!init?.method || init.method === "GET")) {
                return fakeResponse({ webhooks: [] });
            }
            if (url.endsWith("/api/admin/webhooks") && init?.method === "POST") {
                return fakeResponse({ webhook: { id: "wh-new" } }, 201);
            }
            return fakeResponse({});
        });

        render(<WebhooksView />);
        const addButtons = await screen.findAllByRole("button", { name: "studio_webhooks_new" });
        fireEvent.click(addButtons[0]);

        fireEvent.change(screen.getByLabelText("name"), { target: { value: "Task alerts" } });
        fireEvent.change(screen.getByLabelText("studio_webhooks_destination_url"), { target: { value: "https://hooks.example.com/tasks" } });

        const saveBtn = screen.getAllByRole("button", { name: "studio_webhooks_create" }).at(-1)!;
        fireEvent.click(saveBtn);

        await waitFor(() => {
            const post = calls.find(c => c.method === "POST" && c.url.endsWith("/api/admin/webhooks"));
            expect(post).toBeDefined();
            expect(post?.body).toMatchObject({
                name: "Task alerts",
                url: "https://hooks.example.com/tasks",
                events: ["INSERT", "UPDATE", "DELETE"],
                table: "*",
                enabled: true
            });
        });
    });

    it("DbCronJobsPanel submits POST /api/admin/cron/jobs with SQL config", async () => {
        const calls = installFetch((url, init) => {
            if (url.endsWith("/api/admin/cron/jobs") && (!init?.method || init.method === "GET")) {
                return fakeResponse({ jobs: [] });
            }
            if (url.endsWith("/api/admin/cron/jobs") && init?.method === "POST") {
                return fakeResponse({ job: { id: "cj-new" } }, 201);
            }
            return fakeResponse({});
        });

        render(<DbCronJobsPanel />);
        const addBtn = await screen.findByRole("button", { name: "studio_cron_db_new" });
        fireEvent.click(addBtn);

        fireEvent.change(screen.getByLabelText("studio_cron_db_job_name"), { target: { value: "nightly_cleanup" } });
        fireEvent.change(screen.getAllByLabelText("studio_cron_db_kind_sql").at(-1)!, { target: { value: "SELECT 1;" } });
        fireEvent.click(screen.getByRole("button", { name: "studio_cron_db_save" }));

        await waitFor(() => {
            const post = calls.find(c => c.method === "POST" && c.url.endsWith("/api/admin/cron/jobs"));
            expect(post).toBeDefined();
            expect(post?.body).toMatchObject({
                name: "nightly_cleanup",
                schedule: "*/5 * * * *",
                kind: "sql",
                config: { sql: "SELECT 1;" },
                enabled: true
            });
        });
    });
});
