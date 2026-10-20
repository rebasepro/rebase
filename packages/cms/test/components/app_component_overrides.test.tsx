/**
 * @jest-environment jsdom
 */
/**
 * The app-level overrides that were declared, documented, and resolved
 * nowhere.
 *
 * `"Shell.AppBar"`, `"HomePage.CollectionCard"` and `"Auth.LoginView"` are in
 * `AppComponentName`, the docs' override table and the `<Rebase components>`
 * example — and nothing passed them to `useComponentOverride`, so setting one
 * did nothing, silently. `component-override-render-sites.test.ts` in
 * `@rebasepro/cms-types` keeps every declared name resolved somewhere; this
 * renders the three and checks the override is what arrives.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ComponentOverrideMap } from "@rebasepro/cms-types";

const authState: { user: unknown, initialLoading: boolean } = { user: null, initialLoading: false };
const registry: { authConfig?: { loginView?: React.ReactNode } } = {};

jest.mock("@rebasepro/app", () => {
    const actual = jest.requireActual("@rebasepro/app") as Record<string, unknown>;
    const overrides: Record<string, unknown> = {
        useAdminModeController: () => ({ mode: "cms" }),
        useRebaseRegistry: () => registry,
        useAuthController: () => authState,
        LoginView: () => <div>built-in login</div>
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides) ? overrides[key] : actual[key as string]
    });
});

jest.mock("../../src/components/app/Scaffold", () => ({
    Scaffold: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));
jest.mock("../../src/components/app/Drawer", () => ({ Drawer: () => <nav>drawer</nav> }));
jest.mock("../../src/components/SideDialogs", () => ({ SideDialogs: () => null }));
jest.mock("../../src/components/AdminModeSyncer", () => ({ AdminModeSyncer: () => null }));
jest.mock("../../src/components/DefaultAppBar", () => ({
    DefaultAppBar: ({ title }: { title?: string }) => <header>default app bar: {title}</header>
}));
jest.mock("../../src/components/HomePage/NavigationCardBinding", () => ({
    NavigationCardBinding: ({ name }: { name: string }) => <div>default card: {name}</div>
}));

import { GlobalComponentOverrideProvider } from "@rebasepro/app";
import { RebaseLayout } from "../../src/components/RebaseLayout";
import { RebaseAuthGate } from "../../src/components/RebaseAuthGate";
import { SortableNavigationCard } from "../../src/components/HomePage/HomePageDnD";

function withOverrides(overrides: ComponentOverrideMap, node: React.ReactNode) {
    return render(
        <MemoryRouter>
            <GlobalComponentOverrideProvider overrides={overrides}>{node}</GlobalComponentOverrideProvider>
        </MemoryRouter>
    );
}

type Wrapped = { OriginalComponent: React.ComponentType<Record<string, unknown>> } & Record<string, unknown>;

describe("\"Shell.AppBar\"", () => {

    test("without an override there is no top bar, as before", () => {
        withOverrides({}, <RebaseLayout title={"Admin"}/>);
        expect(screen.queryByRole("banner")).toBeNull();
    });

    test("a replacement renders as the top bar, with the layout's title", () => {
        const MyAppBar = ({ title }: { title?: string }) => <header>my app bar: {title}</header>;
        withOverrides({ "Shell.AppBar": { Component: MyAppBar as never } }, <RebaseLayout title={"Admin"}/>);
        expect(screen.getByRole("banner").textContent).toBe("my app bar: Admin");
    });

    test("a wrapper is handed the default bar", () => {
        const Wrapper = ({ OriginalComponent, ...props }: Wrapped) =>
            <div data-testid={"wrapper"}><OriginalComponent {...props}/></div>;
        withOverrides({ "Shell.AppBar": { Component: Wrapper as never, wrap: true } }, <RebaseLayout title={"Admin"}/>);
        expect(screen.getByTestId("wrapper").textContent).toBe("default app bar: Admin");
    });

    test("an `appBar` element still wins, as `drawer` does over \"Shell.Drawer\"", () => {
        const MyAppBar = () => <header>override</header>;
        withOverrides({ "Shell.AppBar": { Component: MyAppBar as never } },
            <RebaseLayout appBar={<header>element</header>}/>);
        expect(screen.getByRole("banner").textContent).toBe("element");
    });
});

describe("\"Auth.LoginView\"", () => {

    test("a replacement is the login screen", () => {
        registry.authConfig = undefined;
        const MyLogin = () => <div>my login</div>;
        withOverrides({ "Auth.LoginView": { Component: MyLogin as never } },
            <RebaseAuthGate><div>app</div></RebaseAuthGate>);
        expect(screen.getByText("my login")).toBeTruthy();
        expect(screen.queryByText("built-in login")).toBeNull();
    });

    test("a wrapper is handed the built-in screen", () => {
        registry.authConfig = undefined;
        const Wrapper = ({ OriginalComponent, ...props }: Wrapped) =>
            <div data-testid={"brand"}><OriginalComponent {...props}/></div>;
        withOverrides({ "Auth.LoginView": { Component: Wrapper as never, wrap: true } },
            <RebaseAuthGate><div>app</div></RebaseAuthGate>);
        expect(screen.getByTestId("brand").textContent).toBe("built-in login");
    });

    test("`<RebaseAuth loginView>` still wins", () => {
        registry.authConfig = { loginView: <div>element login</div> };
        const MyLogin = () => <div>my login</div>;
        withOverrides({ "Auth.LoginView": { Component: MyLogin as never } },
            <RebaseAuthGate><div>app</div></RebaseAuthGate>);
        expect(screen.getByText("element login")).toBeTruthy();
        registry.authConfig = undefined;
    });
});

describe("\"HomePage.CollectionCard\"", () => {

    const entry = { slug: "posts", url: "/c/posts", name: "Posts", type: "collection" } as never;

    test("without an override the built-in card renders", () => {
        withOverrides({}, <SortableNavigationCard entry={entry}/>);
        expect(screen.getByText("default card: Posts")).toBeTruthy();
    });

    test("a replacement renders for each home page entry", () => {
        const MyCard = ({ name }: { name: string }) => <div>my card: {name}</div>;
        withOverrides({ "HomePage.CollectionCard": { Component: MyCard as never } },
            <SortableNavigationCard entry={entry}/>);
        expect(screen.getByText("my card: Posts")).toBeTruthy();
    });
});
