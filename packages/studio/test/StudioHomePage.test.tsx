import { en } from "../../app/src/locales/en";
import React from "react";
import { render, screen } from "@testing-library/react";
import { StudioHomePage } from "../src/components/StudioHomePage";
import "@testing-library/jest-dom";

/**
 * The views RebaseStudio actually registers, in the shape the registry exposes.
 * The home page derives its cards from these — notably, there is no "/users" or
 * "/roles" view, so no card may advertise one.
 */
const devViews = [
    { slug: "sql", name: "SQL Console", group: "Database", icon: "terminal", description: "Execute SQL queries", view: null },
    { slug: "backups", name: "Backups", group: "Database", icon: "Database", description: "Download database backups", view: null },
    { slug: "js", name: "JS Console", group: "Compute", icon: "code", description: "Execute JavaScript", view: null },
    { slug: "storage", name: "Storage", group: "Storage", icon: "HardDrive", description: "Manage storage files", view: null },
    { slug: "api", name: "API Explorer", group: "API", icon: "BookOpen", description: "Interactive API documentation and testing", view: null },
    { slug: "api-keys", name: "API Keys", group: "Access Control", icon: "KeyRound", description: "Create and manage scoped API keys", view: null }
];

const mockRegistry = {
    studioConfig: { devViews } as unknown,
    cmsConfig: { collectionEditor: {} } as unknown
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string) => (en as Record<string, string>)[key] ?? key,
        i18n: { language: "en" }
    }),
    useNavigationGroupLabel: () => (group: string) => group,
    useRebaseContext: () => ({
        baseUrl: "http://localhost:3001",
        collections: []
    }),
    useRebaseRegistry: () => mockRegistry,
    useRestoreScroll: () => ({
        containerRef: React.createRef()
    }),
    useStudioBreadcrumbs: () => ({
        set: jest.fn()
    }),
    useSlot: () => null,
    IconForView: () => <span>Icon</span>,
    SchemaDriftBanner: () => <div>Schema Drift Banner</div>
}));

// Mock react-router navigate
const mockNavigate = jest.fn();
jest.mock("react-router", () => ({
    useNavigate: () => mockNavigate
}));

describe("StudioHomePage Component", () => {
    it("renders a section per group of registered views", () => {
        render(<StudioHomePage />);

        expect(screen.getByRole("region", { name: "Database" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Compute" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "API" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Storage" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Access Control" })).toBeInTheDocument();
    });

    it("renders a card for each registered view", () => {
        render(<StudioHomePage />);

        expect(screen.getByText("SQL Console")).toBeInTheDocument();
        expect(screen.getByText("Execute SQL queries")).toBeInTheDocument();
        expect(screen.getByText("API Explorer")).toBeInTheDocument();
        expect(screen.getByText("Create and manage scoped API keys")).toBeInTheDocument();
    });

    it("renders the collection editor card when the CMS enables one", () => {
        render(<StudioHomePage />);

        expect(screen.getByText("Collections")).toBeInTheDocument();
        expect(screen.getByText("Define and manage your data model and collection schemas")).toBeInTheDocument();
    });

    it("renders a card for a registered view that the old static list omitted", () => {
        render(<StudioHomePage />);

        // "Backups" is a real route; the hand-written section list never listed it.
        expect(screen.getByText("Backups")).toBeInTheDocument();
    });

    it("does not advertise tools that have no registered route", () => {
        render(<StudioHomePage />);

        // "/users" and "/roles" are not Studio views — cards for them 404.
        expect(screen.queryByText("Roles")).not.toBeInTheDocument();
        expect(screen.queryByText("Manage developers and assign roles in your workspace")).not.toBeInTheDocument();
        expect(screen.queryByText("Create and configure fine-grained access permissions")).not.toBeInTheDocument();
    });

    it("hides groups listed in hiddenGroups", () => {
        render(<StudioHomePage hiddenGroups={["Compute"]} />);

        expect(screen.queryByRole("region", { name: "Compute" })).not.toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Database" })).toBeInTheDocument();
    });

    it("renders additional children when provided", () => {
        render(
            <StudioHomePage
                additionalChildrenStart={<div>Start Child</div>}
                additionalChildrenEnd={<div>End Child</div>}
            />
        );
        expect(screen.getByText("Start Child")).toBeInTheDocument();
        expect(screen.getByText("End Child")).toBeInTheDocument();
    });
});
