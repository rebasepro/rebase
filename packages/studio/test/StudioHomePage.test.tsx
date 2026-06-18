import React from "react";
import { render, screen } from "@testing-library/react";
import { StudioHomePage } from "../src/components/StudioHomePage";
import "@testing-library/jest-dom";

// Mock @rebasepro/core hooks and components
jest.mock("@rebasepro/core", () => ({
    useRebaseContext: () => ({
        baseUrl: "http://localhost:3001",
        collections: []
    }),
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

// Mock react-router-dom navigate
const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
    useNavigate: () => mockNavigate
}));

describe("StudioHomePage Component", () => {
    it("renders database, compute, api, storage, and access control sections", () => {
        render(<StudioHomePage />);
        // Assert headings/regions are present
        expect(screen.getByRole("region", { name: "Database" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Compute" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "API" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Storage" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Access Control" })).toBeInTheDocument();

        // Assert tool names/descriptions are present
        expect(screen.getByText("Define and manage your data model and collection schemas")).toBeInTheDocument();
        expect(screen.getByText("Interactive ERD showing tables, columns, and relationships")).toBeInTheDocument();
        expect(screen.getByText("Execute raw SQL queries directly against your database")).toBeInTheDocument();
        expect(screen.getByText("Monitor and manage scheduled background tasks")).toBeInTheDocument();
        expect(screen.getByText("Interactive API documentation with live request testing")).toBeInTheDocument();
        expect(screen.getByText("Browse, upload, and manage files in your storage bucket")).toBeInTheDocument();
        expect(screen.getByText("Manage developers and assign roles in your workspace")).toBeInTheDocument();
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
