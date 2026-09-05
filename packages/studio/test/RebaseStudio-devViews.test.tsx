/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { render } from "@testing-library/react";
import type { AppView, RebaseStudioConfig } from "@rebasepro/cms-types";

/**
 * `devViews` was a declared prop of `<RebaseStudio>` that the component never
 * destructured: it built its own list from `tools` and registered that,
 * overwriting whatever the caller had passed. The prop typechecked, the view
 * never appeared, and there was nothing to see in the drawer that said why.
 */
const registered: RebaseStudioConfig[] = [];

// One object for the whole file: the real dispatch comes from a context and is
// stable, and a fresh one per render would re-fire the registration effect on
// its own, hiding whether the view list is stable.
const dispatch = {
    registerStudio: (config: RebaseStudioConfig) => {
        registered.push(config);
    },
    unregisterStudio: () => undefined
};

const translation = {
    t: (key: string) => (en as Record<string, string>)[key] ?? key,
    i18n: { language: "en" }
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useNavigationGroupLabel: () => (group: string) => group,
    useRebaseRegistryDispatch: () => dispatch
}));

// Statically imported by RebaseStudio, and it pulls in react-router's ESM
// build, which this package's jest config does not transform. Nothing here
// renders it.
jest.mock("../src/components/StudioHomePage", () => ({
    StudioHomePage: () => null
}));

import { RebaseStudio } from "../src/components/RebaseStudio";

const queues: AppView = {
    slug: "queues",
    name: "Queues",
    group: "Compute",
    view: <div/>
};

const latest = () => registered[registered.length - 1];

describe("<RebaseStudio devViews>", () => {

    beforeEach(() => {
        registered.length = 0;
    });

    test("a caller's view is registered beside the built-in tools", () => {
        render(<RebaseStudio tools={["sql"]} devViews={[queues]}/>);

        const slugs = (latest().devViews ?? []).map(v => v.slug);
        expect(slugs).toEqual(["sql", "queues"]);
    });

    test("built-in tools still register when no devViews are passed", () => {
        render(<RebaseStudio tools={["sql", "logs"]}/>);

        const slugs = (latest().devViews ?? []).map(v => v.slug);
        expect(slugs).toEqual(["sql", "logs"]);
    });

    // The whole point of keying the list rather than depending on the array:
    // re-registering remounts whichever Studio view is on screen.
    test("a new array with the same views does not re-register", () => {
        const { rerender } = render(<RebaseStudio tools={["sql"]} devViews={[{ ...queues }]}/>);
        const after = registered.length;

        rerender(<RebaseStudio tools={["sql"]} devViews={[{ ...queues }]}/>);

        expect(registered.length).toBe(after);
    });

    test("but renaming one does", () => {
        const { rerender } = render(<RebaseStudio tools={["sql"]} devViews={[queues]}/>);
        const after = registered.length;

        rerender(<RebaseStudio tools={["sql"]} devViews={[{ ...queues, name: "Job queues" }]}/>);

        expect(registered.length).toBeGreaterThan(after);
        expect((latest().devViews ?? []).map(v => v.name)).toContain("Job queues");
    });
});
