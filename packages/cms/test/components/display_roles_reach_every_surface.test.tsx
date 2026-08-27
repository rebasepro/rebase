import React from "react";
import { render } from "@testing-library/react";

import { SlotValue, isFetchableImageUrl } from "../../src/components/CollectionViewBinding/SlotValue";
import {
    resolveCollectionSlotKeys,
    resolveEntitySlots,
    type EntityPreviewSlots
} from "../../src/components/CollectionViewBinding/usePreviewSlots";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { Entity } from "@rebasepro/types";

/**
 * `admin.display` promises six roles resolved once and read by every surface.
 * Driving a real panel found three places where a role is declared, typed,
 * resolved — and then not rendered. Each is the same shape: one arm of the
 * feature wired, the other never was, and nothing failed.
 *
 *   * `image` accepts "a storage path or a URL … so a resolver may return
 *     either", but only the property-path arm ever reached an image. A resolver's
 *     return value landed in the card's image frame as literal text, because a
 *     property-less slot renders as text and that is right for a title.
 *   * `date` is documented for a card ("the same with the image on top") and a
 *     board card ("drops the image"), and rendered on neither.
 *   * `tags` had no slot at all. `EntityPreviewSlots` never carried the role, so
 *     no view could render it however it was declared.
 *
 * These assert the resolution layer, which is where all three failed. What a
 * given view chooses to lay out is its own business; that a declared role
 * survives to the slots, and that a computed image is renderable as an image, is
 * not.
 */

const IMAGE_URL = "https://cdn.example.com/cover.png";
const IMAGE_PATH = "covers/cover.png";

/**
 * `AdminCollection` is the flattened view — the authored `admin` block is hoisted
 * onto the collection, so `display` sits at the top level here and not under
 * `admin`. `getDeclaredSource` reads `collection.display`.
 */
function collectionWith(display: Record<string, unknown>): AdminCollection<Record<string, unknown>> {
    return {
        name: "Posts",
        singularName: "Post",
        slug: "posts",
        path: "posts",
        properties: {
            title: { name: "Title", type: "string" },
            body: { name: "Body", type: "string" },
            cover: { name: "Cover", type: "string", storage: { storagePath: "covers/" } },
            labels: { name: "Labels", type: "array", of: { name: "Label", type: "string" } },
            published_at: { name: "Published", type: "date" }
        },
        display
    } as unknown as AdminCollection<Record<string, unknown>>;
}

const entity = (values: Record<string, unknown>): Entity<Record<string, unknown>> => ({
    id: 1,
    path: "posts",
    values
} as unknown as Entity<Record<string, unknown>>);

/** `resolveCollectionSlotKeys` needs both, and reads nothing off either here. */
const authController = {} as never;
const propertyConfigs = {} as never;

const slotsFor = (
    display: Record<string, unknown>,
    values: Record<string, unknown>
): EntityPreviewSlots => {
    const collection = collectionWith(display);
    return resolveEntitySlots(
        entity(values),
        collection,
        resolveCollectionSlotKeys(collection, authController, propertyConfigs)
    );
};

describe("a computed image is renderable as an image", () => {

    /**
     * The regression in one assertion: a slot with no property behind it, whose
     * role is `image`, must not render as its own URL in text.
     */
    it("does not render a URL as text", () => {
        const { container } = render(
            <SlotValue slot={{ role: "image", value: IMAGE_URL }} size="small" fill={true}/>
        );
        expect(container.textContent).not.toContain(IMAGE_URL);
    });

    /**
     * A storage path is asserted at the routing level rather than by rendering it.
     * `StorageThumbnail` needs a storage source from context to sign the path, so a
     * bare render throws `storage.getSignedUrl is not a function` — which does
     * confirm the image branch is taken, but by crashing, which is a poor thing to
     * assert. What matters is which of the two branches a string picks.
     */
    it("routes a storage path through storage, and an absolute URL directly", () => {
        expect(isFetchableImageUrl(IMAGE_PATH)).toBe(false);

        for (const url of [
            IMAGE_URL,
            "http://cdn.example.com/a.png",
            "//cdn.example.com/a.png",
            "data:image/png;base64,iVBORw0KGgo=",
            "blob:http://localhost/9f8e"
        ]) {
            expect(isFetchableImageUrl(url)).toBe(true);
        }

        // A path that merely contains a scheme-like segment is still a path.
        expect(isFetchableImageUrl("covers/https/a.png")).toBe(false);
    });

    it("still renders a computed title as text — that is what a title is", () => {
        const { container } = render(
            <SlotValue slot={{ role: "title", value: "Computed heading" }} size="small"/>
        );
        expect(container.textContent).toBe("Computed heading");
    });

    it("renders a computed tags array as text, joined", () => {
        const { container } = render(
            <SlotValue slot={{ role: "tags", value: ["alpha", "beta"] }} size="small"/>
        );
        expect(container.textContent).toContain("alpha");
        expect(container.textContent).toContain("beta");
    });
});

describe("every declared role survives to the slots", () => {

    it("carries tags declared as a property path", () => {
        const slots = slotsFor({ tags: "labels" }, { labels: ["alpha", "beta"] });

        expect(slots.tags).toBeDefined();
        expect(slots.tags?.value).toEqual(["alpha", "beta"]);
        // A path keeps its property, so the array renders with its own preview
        // rather than as `String(value)`.
        expect(slots.tags?.propertyKey).toBe("labels");
    });

    it("leaves tags undefined when the collection declares none", () => {
        // No inference ladder for tags: unlike status or date there is no
        // "first enum" or "looks like a timestamp" that means *labels*, and
        // guessing would put arbitrary chips on every row in every panel.
        const slots = slotsFor({}, { labels: ["alpha"] });
        expect(slots.tags).toBeUndefined();
    });

    it("leaves tags undefined when the declared path holds nothing", () => {
        expect(slotsFor({ tags: "labels" }, {}).tags).toBeUndefined();
        expect(slotsFor({ tags: "labels" }, { labels: [] }).tags).toBeUndefined();
    });

    it("marks each slot with the role it fills", () => {
        // The role is what lets `SlotValue` decide once how a property-less value
        // renders. Without it an image and a title are indistinguishable.
        const slots = slotsFor(
            { image: "cover", date: "published_at", tags: "labels" },
            { cover: IMAGE_PATH, published_at: "2026-03-04T00:00:00Z", labels: ["alpha"], title: "T" }
        );
        expect(slots.image?.role).toBe("image");
        expect(slots.date?.role).toBe("date");
        expect(slots.tags?.role).toBe("tags");
        expect(slots.title?.role).toBe("title");
    });
});
