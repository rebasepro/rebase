/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route } from "react-router";

/**
 * `RebaseRouteDefs` renders the admin's routes inside an app's own navigation.
 * Its `layout` is optional, and without one the routes were wrapped in a layout
 * route whose element was the route list itself — `<Route>` elements rendered
 * as components, outside any `<Routes>`, which React Router refuses with
 * "A <Route> is only ever to be used as the child of <Routes>". Every page
 * threw. Without a layout the routes now sit directly in the route list.
 */

jest.mock("@rebasepro/app", () => {
    const { Routes: RouterRoutes } = jest.requireActual("react-router") as typeof import("react-router");
    const registry = { cmsConfig: {} };
    const translation = { t: (key: string) => key };
    return {
        useRebaseRegistry: () => registry,
        RebaseRoutes: ({ children }: { children?: React.ReactNode }) => <RouterRoutes>{children}</RouterRoutes>,
        UserSettingsView: () => <div>settings view</div>,
        NotFoundPage: () => <div>not found</div>,
        useComponentOverride: (_slot: string, fallback: unknown) => fallback,
        useTranslation: () => translation
    };
});

const navigationState = { loading: false, views: [], adminViews: [] };
jest.mock("../../src/hooks/navigation/contexts/NavigationStateContext", () => ({
    useNavigationStateController: () => navigationState
}));
jest.mock("../../src/hooks/useBreadcrumbsController", () => ({
    useBreadcrumbsController: () => ({ set: () => undefined })
}));
jest.mock("../../src/components/CollectionEditorDialogs", () => ({ CollectionEditorDialogs: () => null }));
jest.mock("../../src/components/HomePage/ContentHomePage", () => ({ ContentHomePage: () => <div>home page</div> }));
jest.mock("../../src/routes/RebaseRoute", () => ({ RebaseRoute: () => <div>collection route</div> }));
jest.mock("../../src/routes/CustomViewRoute", () => ({ CustomViewRoute: () => <div>custom view</div> }));

import { RebaseRouteDefs } from "../../src/components/RebaseRouteDefs";

function at(path: string, defs: React.ReactElement) {
    return render(<MemoryRouter initialEntries={[path]}>{defs}</MemoryRouter>);
}

describe("RebaseRouteDefs without a layout", () => {

    test("renders the page the URL names", () => {
        at("/settings", <RebaseRouteDefs/>);
        expect(screen.getByText("settings view")).toBeTruthy();
    });

    test("renders the app's own routes and the not-found page too", () => {
        at("/mine", <RebaseRouteDefs><Route path={"/mine"} element={<div>my view</div>}/></RebaseRouteDefs>);
        expect(screen.getByText("my view")).toBeTruthy();
    });

    test("an unknown path shows the not-found page", () => {
        at("/nowhere", <RebaseRouteDefs/>);
        expect(screen.getByText("not found")).toBeTruthy();
    });
});

describe("RebaseRouteDefs with a layout", () => {

    test("renders the page inside it, as before", () => {
        const layout = <div data-testid={"layout"}><Outlet/></div>;
        at("/settings", <RebaseRouteDefs layout={layout}/>);
        expect(screen.getByTestId("layout").textContent).toContain("settings view");
    });
});
