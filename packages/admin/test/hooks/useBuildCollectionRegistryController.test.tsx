/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import type { CollectionConfig } from "@rebasepro/types";
import type { UserConfigurationPersistence } from "@rebasepro/admin-types";
import { useBuildCollectionRegistryController } from "../../src/hooks/navigation/useBuildCollectionRegistryController";

const jobs = {
    id: "jobs",
    name: "Jobs",
    path: "jobs_table",
    slug: "jobs",
    table: "jobs_table",
    properties: {
        title: { type: "string",
name: "Title" }
    },
    childCollections: () => [
        {
            id: "applications",
            name: "Applications",
            path: "applications_table",
            slug: "applications",
            table: "applications_table",
            properties: {}
        }
    ]
} as unknown as CollectionConfig;

const companies = {
    id: "companies",
    name: "Companies",
    path: "companies_table",
    slug: "companies",
    table: "companies_table",
    properties: {}
} as unknown as CollectionConfig;

/**
 * Render the hook with `jobs` and `companies` already in the registry.
 * The registry is populated through the ref the hook exposes, which is the same
 * ref `useResolvedCollections` writes to at runtime.
 */
function renderWithCollections(props: Parameters<typeof useBuildCollectionRegistryController>[0] = {}) {
    const rendered = renderHook(() => useBuildCollectionRegistryController(props));
    act(() => {
        rendered.result.current.collectionRegistryRef.current.registerMultiple([jobs, companies]);
    });
    rendered.rerender();
    return rendered;
}

describe("useBuildCollectionRegistryController", () => {

    it("resolves a registered collection by slug", () => {
        const { result } = renderWithCollections();

        expect(result.current.getCollection("jobs")?.slug).toBe("jobs");
        expect(result.current.getCollection("companies")?.name).toBe("Companies");
    });

    it("resolves an entity path to its parent collection", () => {
        const { result } = renderWithCollections();

        // Even segment count means the path points at an entity, so the
        // collection one level up is what should come back.
        expect(result.current.getCollection("jobs/abc123")?.slug).toBe("jobs");
    });

    it("resolves a subcollection through its parent entity", () => {
        const { result } = renderWithCollections();

        expect(result.current.getCollection("jobs/abc123/applications")?.slug).toBe("applications");
    });

    it("returns undefined for a path that matches nothing", () => {
        const { result } = renderWithCollections();

        expect(result.current.getCollection("not_a_collection")).toBeUndefined();
        expect(result.current.getCollection("")).toBeUndefined();
        expect(result.current.getCollection("/")).toBeUndefined();
    });

    it("applies a user override only when it is asked for", () => {
        const userConfigPersistence = {
            getCollectionConfig: () => ({ name: "My Jobs" })
        } as unknown as UserConfigurationPersistence;

        const { result } = renderWithCollections({ userConfigPersistence });

        // The override is a per-user presentation tweak: it must not leak into
        // the default read, which is what the rest of the panel resolves against.
        expect(result.current.getCollection("jobs")?.name).toBe("Jobs");
        expect(result.current.getCollection("jobs", true)?.name).toBe("My Jobs");
    });

    it("exposes the registered collections and flips initialised once they arrive", () => {
        const rendered = renderHook(() => useBuildCollectionRegistryController({}));

        expect(rendered.result.current.collections).toEqual([]);
        expect(rendered.result.current.initialised).toBe(false);

        act(() => {
            rendered.result.current.collectionRegistryRef.current.registerMultiple([jobs, companies]);
        });
        rendered.rerender();

        // Subcollections are registered too — the panel needs them addressable
        // by slug, not only through their parent.
        expect(rendered.result.current.collections.map(c => c.slug)).toEqual(["jobs", "companies", "applications"]);
        expect(rendered.result.current.initialised).toBe(true);
    });

    it("splits an entity path into parent collection slugs and parent ids", () => {
        const { result } = renderWithCollections();

        expect(result.current.getParentCollectionSlugs("jobs/abc123/applications")).toEqual(["jobs"]);
        expect(result.current.getParentEntityIds("jobs/abc123/applications")).toEqual(["abc123"]);
        // Trailing entity id belongs to the collection being addressed, not to a parent.
        expect(result.current.getParentEntityIds("jobs/abc123")).toEqual([]);
    });

    it("converts collection ids to a nested path", () => {
        const { result } = renderWithCollections();

        expect(result.current.convertIdsToPaths(["jobs", "applications"])).toEqual(["jobs", "applications"]);
        expect(() => result.current.convertIdsToPaths(["nope"])).toThrow();
    });
});
