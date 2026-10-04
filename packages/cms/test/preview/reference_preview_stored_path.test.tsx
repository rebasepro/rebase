/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { EntityReference } from "@rebasepro/types";

/**
 * A reference previewed from where it is stored.
 *
 * Read back from Firestore, a reference to a record of `fs_diagnosis` (declared
 * with `path: "diagnosis"`) carries `diagnosis`. The preview looked the
 * collection up and fetched the record by that string, which is also the slug
 * of a Postgres collection — so the card showed a Postgres row, or nothing.
 */

const fetched: { path?: string }[] = [];
const collectionsAskedFor: string[] = [];
let scope: { dataSource?: string; engine?: string } | undefined;

jest.mock("@rebasepro/app", () => ({
    useFetch: (props: { path: string }) => {
        fetched.push(props);
        return { entity: { id: "abc", path: props.path, values: { name: "Flu" } }, dataLoading: false };
    },
    useCustomizationController: () => ({}),
    useComponentOverride: (_id: string, fallback: unknown) => fallback,
    useCollectionScope: () => scope,
    CollectionScopeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ErrorView: ({ error }: { error: unknown }) => <div>{String(error)}</div>
}));

jest.mock("@rebasepro/ui", () => ({
    Skeleton: () => <div/>,
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

jest.mock("../../src/components/EntityPreviewBinding", () => ({
    EntityPreviewBinding: ({ collection }: { collection: { name: string } }) => <div data-testid="card">{collection.name}</div>,
    EntityPreviewContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

jest.mock("../../src/components/InlineEntityPreview", () => ({
    InlineEntityPreview: () => <span/>,
    InlineEntityPreviewMissing: () => <span/>,
    InlineEntityPreviewSkeleton: () => <span/>
}));

jest.mock("../../src/components/EntityPreviewNesting", () => ({
    useIsNestedEntityPreview: () => false,
    useEntityPreviewLayout: () => "card"
}));

// The registry's translation is tested against a real registry in
// common/test/collection_registry_data_path; here it only has to be asked.
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({
        resolveCollectionPath: (path: string, preferredDriver?: string) =>
            path === "diagnosis" && preferredDriver === "firestore" ? "fs_diagnosis" : path,
        getCollection: (path: string) => {
            collectionsAskedFor.push(path);
            return path === "fs_diagnosis"
                ? { slug: "fs_diagnosis", name: "Diagnosis (Firestore)", properties: {} }
                : { slug: "diagnosis", name: "Diagnosis (Postgres)", properties: {} };
        }
    })
}));

import { ReferencePreview } from "../../src/preview/components/ReferencePreview";

describe("ReferencePreview of a reference to a collection stored under a declared path", () => {

    beforeEach(() => {
        fetched.length = 0;
        collectionsAskedFor.length = 0;
    });

    it("previews the Firestore record when read from a Firestore record", () => {
        scope = { dataSource: "firestore", engine: "firestore" };
        render(<ReferencePreview reference={new EntityReference({ id: "abc", path: "diagnosis" })}/>);

        expect(screen.getByTestId("card").textContent).toBe("Diagnosis (Firestore)");
        expect(collectionsAskedFor).toEqual(["fs_diagnosis"]);
        expect(fetched.map(props => props.path)).toEqual(["fs_diagnosis"]);
    });

    it("follows the reference's own driver", () => {
        scope = undefined;
        render(<ReferencePreview reference={new EntityReference({ id: "abc", path: "diagnosis", driver: "firestore" })}/>);

        expect(fetched.map(props => props.path)).toEqual(["fs_diagnosis"]);
    });

    it("previews the Postgres record otherwise, as before", () => {
        scope = { dataSource: "(default)", engine: "postgres" };
        render(<ReferencePreview reference={new EntityReference({ id: "abc", path: "diagnosis" })}/>);

        expect(screen.getByTestId("card").textContent).toBe("Diagnosis (Postgres)");
        expect(fetched.map(props => props.path)).toEqual(["diagnosis"]);
    });
});
