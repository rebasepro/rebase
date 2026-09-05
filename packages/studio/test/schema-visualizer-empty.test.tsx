/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";

/**
 * `undefined` and `[]` are different answers. The Schema Visualizer rendered
 * "Loading schema…" for both, so a project that declares no collections — a
 * fresh scaffold, a backend someone opened the console against — sat on a
 * spinner forever waiting for something that was never coming.
 */

let registryCollections: unknown[] | undefined;

jest.mock("@rebasepro/app", () => ({
    useStudioCollectionRegistry: () => ({ collections: registryCollections }),
    useStudioSidePanelController: () => ({ open: jest.fn(), replace: jest.fn(), close: jest.fn() }),
    useStudioCapabilities: () => ({ codebase: false }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ apiUrl: "http://api.test", apiPath: "/api", getAuthToken: async () => null }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useRebaseContext: () => ({}),
    useRebaseClient: () => ({}),
    ErrorView: () => null
}));

// The canvas pulls in @xyflow/react and dagre; nothing below reaches it.
jest.mock("../src/components/SchemaVisualizer/SchemaVisualizerCanvasBody", () => ({}), { virtual: true });

import { SchemaVisualizer } from "../src/components/SchemaVisualizer/SchemaVisualizer";

beforeEach(() => {
    registryCollections = undefined;
});

describe("SchemaVisualizer with nothing to draw", () => {

    it("waits while the registry has not answered yet", () => {
        registryCollections = undefined;
        render(<SchemaVisualizer/>);
        expect(screen.getByText(/Loading schema/i)).toBeTruthy();
    });

    it("says nothing is declared once the registry answers with none", () => {
        registryCollections = [];
        render(<SchemaVisualizer/>);

        expect(screen.getByText(/No collections declared/i)).toBeTruthy();
        expect(screen.queryByText(/Loading schema/i)).toBeNull();
    });

    it("names a command that exists, and the view that adds one", () => {
        registryCollections = [];
        render(<SchemaVisualizer/>);

        expect(screen.getByText("rebase schema introspect")).toBeTruthy();
        expect(screen.getByText("Edit collections")).toBeTruthy();
    });
});
